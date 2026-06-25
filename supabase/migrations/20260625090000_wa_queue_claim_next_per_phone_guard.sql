-- ============================================================
-- Prevent duplicate outbound replies for the same WhatsApp phone
-- ============================================================
--
-- wa_queue_upsert merges only pending/waiting bursts. If a guest sends another
-- message while the first entry is already processing, a second queue row can be
-- created. Without a per-phone claim guard, another worker can claim that row
-- immediately and send a duplicate reply.
--
-- Fix: wa_queue_claim_next now claims at most one active entry per phone while
-- another entry for that phone has a live processing lock. It also only lets the
-- oldest ready row per phone be claimed, so SKIP LOCKED cannot hand a sibling
-- row from the same phone to a second worker during a concurrent claim.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_wa_cq_processing_phone_lock
  ON public.wa_conversation_queue (phone, lock_expires_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.wa_queue_claim_next(p_worker_id text)
RETURNS TABLE(
  entry_id          uuid,
  phone             text,
  thread_id         uuid,
  message_count     integer,
  last_message_body text,
  attempt           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM   public.wa_conversation_queue q
    WHERE  (
             (q.status IN ('pending', 'waiting') AND q.process_after <= now())
          OR (q.status = 'retrying'              AND q.next_retry_at <= now())
           )
      AND  pg_try_advisory_xact_lock(hashtext('wa_queue_claim_next:' || q.phone)::bigint)
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.wa_conversation_queue active
             WHERE  active.phone = q.phone
               AND  active.status = 'processing'
               AND  active.lock_expires_at > now()
           )
      AND  NOT EXISTS (
             SELECT 1
             FROM   public.wa_conversation_queue older
             WHERE  older.phone = q.phone
               AND  older.id <> q.id
               AND  (
                      (older.status IN ('pending', 'waiting') AND older.process_after <= now())
                   OR (older.status = 'retrying'              AND older.next_retry_at <= now())
                    )
               AND  (older.process_after, older.created_at, older.id)
                    < (q.process_after, q.created_at, q.id)
           )
    ORDER  BY q.process_after ASC
    FOR UPDATE SKIP LOCKED
    LIMIT  1
  ),
  claimed AS (
    UPDATE public.wa_conversation_queue q
    SET
      status          = 'processing',
      worker_id       = p_worker_id,
      started_at      = now(),
      locked_at       = now(),
      lock_expires_at = now() + interval '120 seconds',
      heartbeat_at    = now(),
      attempt         = q.attempt + 1,
      updated_at      = now()
    FROM   picked
    WHERE  q.id = picked.id
    RETURNING q.id, q.phone, q.thread_id, q.message_count, q.last_message_body, q.attempt
  )
  SELECT c.id, c.phone, c.thread_id, c.message_count, c.last_message_body, c.attempt
  FROM   claimed c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_claim_next(text) TO service_role;
