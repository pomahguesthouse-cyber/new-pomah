-- Debounce fixes:
-- 1) Do not fail pending/waiting rows while process_after is still in the future.
-- 2) Remove UPDATE trigger that spawned duplicate workers on every debounce extend.

DROP TRIGGER IF EXISTS t_process_wa_queue_update ON public.wa_conversation_queue;

CREATE OR REPLACE FUNCTION public.wa_queue_cleanup_zombies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH cleaned AS (
    UPDATE public.wa_conversation_queue
    SET
      status       = 'failed',
      last_error   = 'zombie_timeout: worker lock expired without completing',
      completed_at = now(),
      updated_at   = now()
    WHERE status = 'processing'
      AND lock_expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cleaned;

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
