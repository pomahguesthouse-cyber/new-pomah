-- ============================================================
-- AI Retry Audit — log every LLM retry event for observability
-- ============================================================
--
-- Each row represents one failed LLM attempt that triggered a retry.
-- The rollup view (ai_retry_stats) aggregates by hour/reason/agent for
-- dashboards and alerting.
-- ============================================================

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_retry_audit (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID        REFERENCES whatsapp_threads(id) ON DELETE SET NULL,
  phone           TEXT        NOT NULL,
  agent_key       TEXT        NOT NULL,
  attempt         INTEGER     NOT NULL,
  reason          TEXT        NOT NULL,
  model           TEXT,
  latency_ms      INTEGER,
  resolved        BOOLEAN     NOT NULL DEFAULT false,
  queue_entry_id  UUID        REFERENCES wa_conversation_queue(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_retry_audit_created
  ON public.ai_retry_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retry_audit_reason
  ON public.ai_retry_audit (reason, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retry_audit_thread
  ON public.ai_retry_audit (thread_id)
  WHERE thread_id IS NOT NULL;

-- ─── Rollup view ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.ai_retry_stats AS
SELECT
  date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta') AS hour_wib,
  reason,
  agent_key,
  COUNT(*)                                    AS total,
  COUNT(*) FILTER (WHERE resolved)            AS resolved_count,
  ROUND(AVG(latency_ms))::int                 AS avg_latency_ms
FROM   public.ai_retry_audit
GROUP  BY hour_wib, reason, agent_key
ORDER  BY hour_wib DESC;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_retry_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ai_retry_audit'
      AND policyname = 'authenticated read retry audit'
  ) THEN
    CREATE POLICY "authenticated read retry audit" ON public.ai_retry_audit
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT ON public.ai_retry_audit  TO authenticated;
GRANT ALL    ON public.ai_retry_audit  TO service_role;
GRANT SELECT ON public.ai_retry_stats  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
