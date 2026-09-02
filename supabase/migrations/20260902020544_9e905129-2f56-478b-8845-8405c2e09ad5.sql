CREATE OR REPLACE FUNCTION public.merge_wa_threads_to_canonical_phone(p_canonical_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := public.normalize_wa_identity(p_canonical_phone);
  v_keep uuid;
  v_changed integer := 0;
BEGIN
  IF NOT public.is_public_wa_phone(v_phone) THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_keep
  FROM public.whatsapp_threads
  WHERE phone = v_phone
     OR canonical_phone = v_phone
     OR public.resolve_wa_canonical_phone(phone) = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_keep IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.whatsapp_messages
  SET thread_id = v_keep
  WHERE thread_id IN (
    SELECT id
    FROM public.whatsapp_threads
    WHERE id <> v_keep
      AND (
        phone = v_phone
        OR canonical_phone = v_phone
        OR public.resolve_wa_canonical_phone(phone) = v_phone
      )
  );
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF to_regclass('public.conversation_alerts') IS NOT NULL THEN
    UPDATE public.conversation_alerts
    SET thread_id = v_keep,
        phone = v_phone
    WHERE public.resolve_wa_canonical_phone(phone) = v_phone;
  END IF;

  IF to_regclass('public.ai_retry_audit') IS NOT NULL THEN
    UPDATE public.ai_retry_audit
    SET thread_id = v_keep,
        phone = v_phone
    WHERE public.resolve_wa_canonical_phone(phone) = v_phone;
  END IF;

  IF to_regclass('public.wa_conversation_queue') IS NOT NULL THEN
    UPDATE public.wa_conversation_queue
    SET thread_id = v_keep,
        phone = v_phone
    WHERE public.resolve_wa_canonical_phone(phone) = v_phone;
  END IF;

  DELETE FROM public.whatsapp_threads
  WHERE id <> v_keep
    AND (
      phone = v_phone
      OR canonical_phone = v_phone
      OR public.resolve_wa_canonical_phone(phone) = v_phone
    );

  UPDATE public.whatsapp_threads t
  SET phone = v_phone,
      canonical_phone = v_phone,
      identity_type = 'phone',
      sync_error = NULL,
      last_message_at = COALESCE((
        SELECT max(m.sent_at)
        FROM public.whatsapp_messages m
        WHERE m.thread_id = v_keep
      ), t.last_message_at),
      last_message_preview = COALESCE((
        SELECT left(m.body, 120)
        FROM public.whatsapp_messages m
        WHERE m.thread_id = v_keep
        ORDER BY m.sent_at DESC
        LIMIT 1
      ), t.last_message_preview)
  WHERE t.id = v_keep;

  RETURN v_changed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_wa_threads_to_canonical_phone(text) TO anon, authenticated, service_role;