CREATE OR REPLACE FUNCTION public.is_lid_identity(p_raw text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(p_raw, '') ~* '@lid(?:\b|[_@.-]|$)'
$$;

CREATE OR REPLACE FUNCTION public.is_public_wa_phone(p_raw text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v text := public.normalize_wa_identity(p_raw);
BEGIN
  RETURN v IS NOT NULL AND v ~ '^62[0-9]{8,14}$';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_wa_canonical_phone(p_identity text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_identity text := public.normalize_wa_identity(p_identity);
  v_canonical text;
BEGIN
  IF v_identity IS NULL THEN RETURN NULL; END IF;

  SELECT canonical_phone INTO v_canonical
  FROM public.wa_identity_aliases
  WHERE alias_value = v_identity AND is_active = true
  LIMIT 1;

  IF v_canonical IS NOT NULL THEN RETURN v_canonical; END IF;
  IF public.is_public_wa_phone(v_identity) THEN RETURN v_identity; END IF;
  RETURN v_identity;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_resolved_public_wa_phone(p_identity text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_resolved text := public.resolve_wa_canonical_phone(p_identity);
BEGIN
  RETURN public.is_public_wa_phone(v_resolved);
END;
$$;

SELECT public.upsert_wa_identity_alias(
  '6285326098063',
  '23893054091500',
  'lid',
  'guest',
  'Diyah',
  'manual_fix',
  '{"note":"Map WPPConnect LID Diyah ke nomor asli"}'::jsonb
);

SELECT public.upsert_wa_identity_alias(
  '6285326098063',
  '23893054091500@lid',
  'lid',
  'guest',
  'Diyah',
  'manual_fix',
  '{"note":"Map WPPConnect LID Diyah dengan suffix"}'::jsonb
);

UPDATE public.whatsapp_threads
SET phone = '6285326098063',
    display_name = COALESCE(NULLIF(display_name, ''), 'Diyah')
WHERE phone = '23893054091500'
   OR id IN (
     SELECT thread_id
     FROM public.whatsapp_messages
     WHERE metadata::text ILIKE '%23893054091500%'
        OR COALESCE(wpp_id, '') ILIKE '%23893054091500%'
   );

UPDATE public.wa_conversation_queue
SET phone = '6285326098063'
WHERE phone = '23893054091500';

DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text, text, text, text);
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name text,
  p_body text,
  p_wpp_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_normalized text := public.normalize_wa_identity(p_phone);
  v_from_lid boolean := public.is_lid_identity(p_phone) OR public.is_lid_identity(p_wpp_id);
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id uuid;
  v_message_id uuid;
  v_wpp_id text := NULLIF(btrim(p_wpp_id), '');
  v_unresolved boolean;
  v_meta jsonb;
BEGIN
  IF v_phone IS NULL THEN v_phone := v_normalized; END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'phone identity kosong'; END IF;
  v_unresolved := v_from_lid AND NOT public.is_resolved_public_wa_phone(p_phone);

  IF v_wpp_id IS NOT NULL THEN
    SELECT id INTO v_message_id FROM public.whatsapp_messages WHERE wpp_id = v_wpp_id LIMIT 1;
    IF v_message_id IS NOT NULL THEN RETURN v_message_id; END IF;
  END IF;

  PERFORM public.upsert_wa_identity_alias(
    v_phone,
    COALESCE(v_normalized, p_phone),
    CASE WHEN v_from_lid THEN 'lid' WHEN public.is_public_wa_phone(p_phone) THEN 'phone' ELSE 'unknown' END,
    'unknown',
    p_name,
    'receive_whatsapp_message',
    jsonb_build_object('wpp_id', v_wpp_id, 'identity_unresolved', v_unresolved)
  );

  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (phone, display_name, status, unread_count)
    VALUES (v_phone, p_name, 'open', 0)
    RETURNING id INTO v_thread_id;
  END IF;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'raw_identity', p_phone,
    'identity_type', CASE WHEN v_from_lid THEN 'lid' WHEN public.is_public_wa_phone(p_phone) THEN 'phone' ELSE 'unknown' END,
    'lid_alias', CASE WHEN v_from_lid THEN v_normalized ELSE NULL END,
    'canonical_phone', v_phone,
    'identity_unresolved', v_unresolved,
    'wpp_id', v_wpp_id
  ));

  INSERT INTO public.whatsapp_messages (thread_id, direction, body, wpp_id, metadata)
  VALUES (v_thread_id, 'in', p_body, v_wpp_id, v_meta)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    display_name = COALESCE(NULLIF(p_name, ''), display_name),
    last_message_preview = LEFT(p_body, 120),
    last_message_at = now(),
    unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(p_phone text, p_name text, p_body text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.receive_whatsapp_message(p_phone, p_name, p_body, NULL::text);
$$;

CREATE OR REPLACE FUNCTION public.wa_queue_upsert(
  p_phone text,
  p_thread_id uuid,
  p_message_id uuid,
  p_body text,
  p_delay_ms integer,
  p_max_wait_ms integer
)
RETURNS TABLE(entry_id uuid, sleep_ms integer, is_new_burst boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_existing_id uuid;
  v_max_wait_until timestamptz;
  v_new_process_after timestamptz;
  v_sleep_ms integer;
BEGIN
  IF v_phone IS NULL THEN v_phone := public.normalize_wa_identity(p_phone); END IF;

  IF NOT public.is_resolved_public_wa_phone(v_phone) THEN
    IF p_message_id IS NOT NULL THEN
      UPDATE public.whatsapp_messages
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'identity_unresolved', true,
        'queue_blocked', true,
        'queue_block_reason', 'identity_unresolved',
        'original_phone', p_phone,
        'resolved_phone', v_phone
      )
      WHERE id = p_message_id;
    END IF;
    RAISE WARNING '[WA_QUEUE_BLOCKED] identity_unresolved original=% resolved=%', p_phone, v_phone;
    RETURN;
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
    SET status = 'waiting', process_after = v_new_process_after, last_message_body = p_body,
        last_message_id = p_message_id, message_count = message_count + 1, updated_at = now()
    WHERE id = v_existing_id;
    v_sleep_ms := GREATEST(0, EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000)::integer;
    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;
  ELSE
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);
    INSERT INTO public.wa_conversation_queue (phone, thread_id, last_message_id, last_message_body, process_after, max_wait_until, status, message_count)
    VALUES (v_phone, p_thread_id, p_message_id, p_body, v_new_process_after, v_max_wait_until, 'pending', 1)
    RETURNING id INTO v_existing_id;
    v_sleep_ms := p_delay_ms;
    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_lid_identity(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_public_wa_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_resolved_public_wa_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_wa_canonical_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
