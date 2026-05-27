-- ============================================================
-- Make zombie cleanup retry instead of permanently failing
-- ============================================================
--
-- Before: a 'processing' entry whose worker lock expired (e.g. the worker
-- stalled on a DB/LLM call during a transient outage) was set straight to
-- 'failed' — a terminal state with no retry. A single infrastructure blip
-- therefore dropped the reply permanently (observed: "zombie_timeout").
--
-- After: an expired-lock entry transitions to 'retrying' with exponential
-- backoff when attempts remain, so the poll worker (wa_queue_claim_next picks
-- up retrying entries past next_retry_at) reprocesses it. Only when attempts
-- are exhausted does it become 'failed'. Pending/waiting rows that blew past
-- max_wait_until without ever being claimed are still failed (belt-and-braces).
-- ============================================================

CREATE OR REPLACE FUNCTION public.wa_queue_cleanup_zombies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Expired-lock workers: retry if attempts remain, else fail.
  WITH cleaned AS (
    UPDATE public.wa_conversation_queue
    SET
      status        = CASE WHEN attempt < max_attempts THEN 'retrying' ELSE 'failed' END,
      last_error    = 'zombie_timeout: worker lock expired without completion',
      next_retry_at = CASE
                        WHEN attempt < max_attempts
                        THEN now() + make_interval(secs => POWER(2.0, attempt::float))
                        ELSE next_retry_at
                      END,
      completed_at  = CASE WHEN attempt < max_attempts THEN NULL ELSE now() END,
      worker_id     = NULL,
      lock_expires_at = NULL,
      updated_at    = now()
    WHERE status = 'processing'
      AND lock_expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cleaned;

  -- Pending/waiting that blew past max_wait_until and was never claimed.
  WITH stale AS (
    UPDATE public.wa_conversation_queue
    SET
      status       = 'failed',
      last_error   = 'max_wait_exceeded: debounce ended but no worker completed',
      completed_at = now(),
      updated_at   = now()
    WHERE status IN ('pending', 'waiting')
      AND process_after <= now() - interval '3 seconds'
      AND max_wait_until < now() - interval '3 seconds'
    RETURNING id
  )
  SELECT v_count + COUNT(*) INTO v_count FROM stale;

  RETURN v_count;
END;
$$;
