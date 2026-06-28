-- Widen wa_conversation_queue lock TTL 30s -> 40s.
-- Rationale: heartbeat ticks every 7s from the worker, but Cloudflare Workers
-- can skip setInterval ticks under load. A 30s TTL left only ~3 ticks of slack,
-- so a live-but-busy worker was being reaped as a "zombie", forcing 2-3 retry
-- cycles (~4 min) before a reply that had actually succeeded was re-sent.
-- 40s keeps TTL < max_wait_until (~45s) so the zombie-cleanup invariant holds,
-- while giving ~5 heartbeat ticks of slack. Pure value change, no logic change.

CREATE OR REPLACE FUNCTION public.wa_queue_heartbeat(
  p_entry_id  uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.wa_conversation_queue
  SET
    heartbeat_at    = now(),
    lock_expires_at = now() + interval '40 seconds',
    updated_at      = now()
  WHERE id        = p_entry_id
    AND worker_id = p_worker_id
    AND status    = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

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
      lock_expires_at = now() + interval '40 seconds',
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

GRANT EXECUTE ON FUNCTION public.wa_queue_heartbeat(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_claim_next(text) TO service_role;
