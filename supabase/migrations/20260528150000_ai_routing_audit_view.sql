-- ============================================================
-- Level 1 routing audit — views over existing reply metadata
-- ============================================================
--
-- Every AI reply already stores intent/agent_key/routing_confidence/escalated/
-- is_fallback in whatsapp_messages.metadata. These views unpack that JSON into
-- queryable columns so you can audit routing WITHOUT any new write path:
--   * which intent routes to which agent, and how often
--   * which conversations are likely mis-routes (fallback / low confidence /
--     escalated) and should be reviewed by a human
-- ============================================================

-- ── Detail: one row per AI reply, JSON unpacked ────────────────────────────────
CREATE OR REPLACE VIEW public.ai_routing_audit AS
SELECT
  m.id                                            AS message_id,
  m.thread_id,
  t.phone,
  m.sent_at,
  m.metadata->>'intent'                           AS intent,
  m.metadata->>'agent_key'                        AS agent_key,
  NULLIF(m.metadata->>'routing_confidence', '')::float AS routing_confidence,
  COALESCE((m.metadata->>'is_fallback')::boolean, false) AS is_fallback,
  COALESCE((m.metadata->>'escalated')::boolean,   false) AS escalated,
  m.body                                          AS reply_body
FROM   public.whatsapp_messages m
LEFT   JOIN public.whatsapp_threads t ON t.id = m.thread_id
WHERE  m.direction = 'out'
  AND  m.metadata ? 'intent';

-- ── Rollup: intent → agent distribution + fallback/confidence health ───────────
CREATE OR REPLACE VIEW public.ai_routing_intent_stats AS
SELECT
  intent,
  agent_key,
  COUNT(*)                                            AS total,
  COUNT(*) FILTER (WHERE is_fallback)                 AS fallback_count,
  COUNT(*) FILTER (WHERE escalated)                   AS escalated_count,
  ROUND(AVG(routing_confidence)::numeric, 2)          AS avg_confidence,
  COUNT(*) FILTER (WHERE routing_confidence < 0.5)    AS low_confidence_count
FROM   public.ai_routing_audit
GROUP  BY intent, agent_key
ORDER  BY total DESC;

-- ── Review queue: likely mis-routes worth a human look ─────────────────────────
CREATE OR REPLACE VIEW public.ai_routing_review AS
SELECT *
FROM   public.ai_routing_audit
WHERE  is_fallback
   OR  escalated
   OR  routing_confidence < 0.5
ORDER  BY sent_at DESC;

GRANT SELECT ON public.ai_routing_audit         TO authenticated, service_role;
GRANT SELECT ON public.ai_routing_intent_stats  TO authenticated, service_role;
GRANT SELECT ON public.ai_routing_review        TO authenticated, service_role;
