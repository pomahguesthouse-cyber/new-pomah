-- ============================================================
-- Phase 2 — Poll-based dispatcher: wa_queue_claim_next
-- ============================================================
--
-- Atomically claims the SINGLE oldest entry that is ready to process:
--   * pending/waiting whose idle window (process_after) has elapsed, OR
--   * retrying whose next_retry_at has elapsed.
--
-- FOR UPDATE SKIP LOCKED lets N worker instances poll concurrently:
-- each row is handed to exactly one worker; others skip locked rows
-- instead of blocking. This is the multi-instance-safe core.
--
-- Unlike wa_queue_claim (which targets a known entry_id from the webhook),
-- this picks ANY ready entry — so the worker never needs to wait in-request
-- for the debounce window; the window is enforced purely by process_after.
-- ============================================================

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
    WHERE  (q.status IN ('pending', 'waiting') AND q.process_after <= now())
       OR  (q.status = 'retrying'              AND q.next_retry_at <= now())
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
      lock_expires_at = now() + interval '30 seconds',
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

GRANT EXECUTE ON FUNCTION public.wa_queue_claim_next(text) TO anon;
GRANT EXECUTE ON FUNCTION public.wa_queue_claim_next(text) TO service_role;
