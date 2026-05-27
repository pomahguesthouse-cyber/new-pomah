-- ============================================================
-- Fix double-reply race in wa_queue_upsert
-- ============================================================
--
-- Bug: when two messages of a burst arrive nearly simultaneously (or hit
-- different instances), BOTH calls run the "find existing pending/waiting
-- entry" SELECT before either INSERT is committed. Neither sees a row, so both
-- take the INSERT branch and create a SEPARATE pending entry for the same
-- phone. The worker then processes both → TWO AI calls and TWO replies for what
-- should be a single grouped burst. FOR UPDATE SKIP LOCKED does not help here
-- because there is no existing row to lock yet.
--
-- Fix: take a transaction-scoped advisory lock keyed on the phone at the very
-- top of the function. Concurrent upserts for the SAME phone now serialize —
-- the second waits until the first commits, then its SELECT sees the inserted
-- row and correctly EXTENDS it instead of inserting a duplicate. Different
-- phones hash to different keys and never block each other.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wa_queue_upsert(
  p_phone         text,
  p_thread_id     uuid,
  p_message_id    uuid,
  p_body          text,
  p_delay_ms      integer,
  p_max_wait_ms   integer
)
RETURNS TABLE(
  entry_id     uuid,
  sleep_ms     integer,
  is_new_burst boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id       uuid;
  v_max_wait_until    timestamptz;
  v_new_process_after timestamptz;
  v_sleep_ms          integer;
BEGIN
  -- Serialize all upserts for this phone for the duration of this transaction.
  -- Released automatically on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('wa_queue_upsert:' || p_phone)::bigint);

  SELECT q.id, q.max_wait_until
  INTO   v_existing_id, v_max_wait_until
  FROM   wa_conversation_queue q
  WHERE  q.phone  = p_phone
    AND  q.status IN ('pending', 'waiting')
  ORDER  BY q.created_at DESC
  LIMIT  1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    -- Extend existing burst, capped at max_wait_until.
    v_new_process_after := LEAST(
      now() + make_interval(secs => p_delay_ms::float / 1000.0),
      v_max_wait_until
    );

    UPDATE wa_conversation_queue
    SET
      status            = 'waiting',
      process_after     = v_new_process_after,
      last_message_body = p_body,
      last_message_id   = p_message_id,
      message_count     = message_count + 1,
      updated_at        = now()
    WHERE id = v_existing_id;

    v_sleep_ms := GREATEST(0,
      EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000
    )::integer;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;
  ELSE
    -- New burst.
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until    := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);

    INSERT INTO wa_conversation_queue (
      phone, thread_id, last_message_id, last_message_body,
      process_after, max_wait_until, status, message_count
    ) VALUES (
      p_phone, p_thread_id, p_message_id, p_body,
      v_new_process_after, v_max_wait_until, 'pending', 1
    )
    RETURNING id INTO v_existing_id;

    v_sleep_ms := p_delay_ms;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO service_role;
