-- Do not drop WhatsApp replies just because the queue drainer is late.
--
-- `max_wait_until` is the hard cap for batching a burst, not a delivery SLA.
-- If pg_cron / keepalive is delayed, pending rows can pass max_wait_until
-- before any worker claims them. The previous cleanup marked those rows failed
-- at attempt=0 (`max_wait_exceeded`), which made the chatbot look silent.

CREATE OR REPLACE FUNCTION public.wa_queue_cleanup_zombies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Zombies (processing entries past lock_expires_at):
  --   - if attempt < max_attempts -> schedule retry with exponential backoff
  --   - else                      -> mark as failed (terminal)
  WITH cleaned AS (
    UPDATE public.wa_conversation_queue
    SET
      status = CASE
        WHEN attempt < max_attempts THEN 'retrying'
        ELSE 'failed'
      END,
      last_error = 'zombie_timeout: worker lock expired without completing',
      next_retry_at = CASE
        WHEN attempt < max_attempts
          THEN now() + make_interval(secs => POWER(2.0, attempt::float))
        ELSE NULL
      END,
      completed_at = CASE
        WHEN attempt < max_attempts THEN NULL
        ELSE now()
      END,
      worker_id = NULL,
      lock_expires_at = NULL,
      updated_at = now()
    WHERE status = 'processing'
      AND lock_expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cleaned;

  -- Stale pending/waiting rows mean the scheduler was late, not that the guest
  -- should be abandoned. Make them claimable immediately and keep attempt=0.
  WITH stale AS (
    UPDATE public.wa_conversation_queue
    SET
      process_after = LEAST(process_after, now()),
      last_error = NULL,
      updated_at = now()
    WHERE status IN ('pending', 'waiting')
      AND process_after <= now() - interval '3 seconds'
      AND max_wait_until < now() - interval '3 seconds'
    RETURNING id
  )
  SELECT v_count + COUNT(*) INTO v_count FROM stale;

  RETURN v_count;
END;
$$;

-- Re-open recent rows that were incorrectly failed before the cleanup fix.
UPDATE public.wa_conversation_queue
SET
  status = 'pending',
  process_after = LEAST(process_after, now()),
  max_wait_until = GREATEST(max_wait_until, now() + interval '45 seconds'),
  completed_at = NULL,
  worker_id = NULL,
  lock_expires_at = NULL,
  next_retry_at = NULL,
  last_error = NULL,
  updated_at = now()
WHERE status = 'failed'
  AND attempt = 0
  AND last_error LIKE 'max_wait_exceeded:%'
  AND created_at >= now() - interval '2 hours';

GRANT EXECUTE ON FUNCTION public.wa_queue_cleanup_zombies() TO service_role;
