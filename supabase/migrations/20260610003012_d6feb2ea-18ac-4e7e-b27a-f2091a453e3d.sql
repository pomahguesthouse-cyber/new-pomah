CREATE OR REPLACE FUNCTION public.wa_queue_cleanup_zombies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  -- Zombies (processing entries past lock_expires_at):
  --   - if attempt < max_attempts → schedule retry with exponential backoff
  --   - else                       → mark as failed (terminal)
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
      worker_id    = NULL,
      lock_expires_at = NULL,
      updated_at   = now()
    WHERE status = 'processing'
      AND lock_expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cleaned;

  -- Stale pending/waiting (idle window long expired with no worker) → fail terminal.
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
$function$;