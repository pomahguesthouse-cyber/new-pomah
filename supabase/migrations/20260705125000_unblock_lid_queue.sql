-- Allow unresolved WhatsApp LID identities to enter the queue.
-- The message/send layer will try to deliver with the available identity,
-- while metadata keeps the unresolved flag visible for admin diagnostics.

CREATE OR REPLACE FUNCTION public.wa_queue_upsert(
  p_phone text,
  p_thread_id uuid,
  p_message_id uuid,
  p_body text,
  p_delay_ms integer,
  p_max_wait_ms integer
)
RETURNS TABLE(entry_id uuid, sleep_ms integer, is_new_burst boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_existing_id uuid;
  v_max_wait_until timestamptz;
  v_new_process_after timestamptz;
  v_sleep_ms integer;
  v_unresolved boolean;
BEGIN
  IF v_phone IS NULL THEN
    v_phone := public.normalize_wa_identity(p_phone);
  END IF;

  IF v_phone IS NULL THEN
    RETURN;
  END IF;

  v_unresolved := NOT public.is_resolved_public_wa_phone(v_phone);

  IF v_unresolved AND p_message_id IS NOT NULL THEN
    UPDATE public.whatsapp_messages
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'identity_unresolved', true,
      'queue_allowed_unresolved_lid', true,
      'original_phone', p_phone,
      'resolved_phone', v_phone
    )
    WHERE id = p_message_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wa_queue_upsert:' || v_phone)::bigint);

  SELECT q.id, q.max_wait_until INTO v_existing_id, v_max_wait_until
  FROM public.wa_conversation_queue q
  WHERE q.phone = v_phone AND q.status IN ('pending', 'waiting')
  ORDER BY q.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    v_new_process_after := LEAST(now() + make_interval(secs => p_delay_ms::float / 1000.0), v_max_wait_until);
    UPDATE public.wa_conversation_queue
    SET status = 'waiting',
        process_after = v_new_process_after,
        last_message_body = p_body,
        last_message_id = p_message_id,
        message_count = message_count + 1,
        updated_at = now()
    WHERE id = v_existing_id;
    v_sleep_ms := GREATEST(0, EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000)::integer;
    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;
  ELSE
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);
    INSERT INTO public.wa_conversation_queue (
      phone, thread_id, last_message_id, last_message_body,
      process_after, max_wait_until, status, message_count
    ) VALUES (
      v_phone, p_thread_id, p_message_id, p_body,
      v_new_process_after, v_max_wait_until, 'pending', 1
    )
    RETURNING id INTO v_existing_id;
    v_sleep_ms := p_delay_ms;
    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
