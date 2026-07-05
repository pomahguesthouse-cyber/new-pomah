-- ============================================================
-- Repair WPPConnect LID -> public WhatsApp phone identity flow
-- ============================================================
-- Why:
--   WhatsApp/WPPConnect can emit Local Identifier (LID) identities like
--   4114662604939@lid instead of the real MSISDN phone. The admin/correction UI
--   should keep WPPConnect chat IDs for sync, but conversation identity must be
--   canonicalized to the public WhatsApp number whenever we can infer it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wa_identity_from_wpp_message_id(p_wpp_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := lower(coalesce(p_wpp_id, ''));
  m text[];
BEGIN
  IF btrim(v) = '' THEN
    RETURN NULL;
  END IF;

  -- Common WPP/WA ids contain the remote jid somewhere inside the id, for example
  -- false_4114662604939@lid_3EB0... or 628xxx@c.us_3EB0...
  m := regexp_match(v, '([0-9]{8,18})@(lid|c\.us|s\.whatsapp\.net)');
  IF m IS NOT NULL THEN
    RETURN public.normalize_wa_identity(m[1] || '@' || m[2]);
  END IF;

  RETURN NULL;
END;
$$;

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

DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text, text, text, text);
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name text,
  p_body text,
  p_wpp_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone_identity text := public.normalize_wa_identity(p_phone);
  v_wpp_identity text := public.wa_identity_from_wpp_message_id(p_wpp_id);
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id uuid;
  v_message_id uuid;
  v_wpp_id text := NULLIF(btrim(p_wpp_id), '');
  v_from_lid boolean := public.is_lid_identity(p_phone) OR public.is_lid_identity(p_wpp_id);
  v_unresolved boolean;
  v_meta jsonb;
BEGIN
  -- If one side is public phone and the other side is LID/JID, create a durable alias.
  IF NOT public.is_public_wa_phone(v_phone) AND public.is_public_wa_phone(v_wpp_identity) THEN
    v_phone := v_wpp_identity;
  END IF;

  IF v_phone IS NULL THEN
    v_phone := v_phone_identity;
  END IF;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'phone identity kosong';
  END IF;

  IF public.is_public_wa_phone(v_phone) THEN
    PERFORM public.upsert_wa_identity_alias(
      v_phone,
      v_phone,
      'phone',
      'unknown',
      p_name,
      'receive_whatsapp_message',
      jsonb_build_object('wpp_id', v_wpp_id, 'source_identity', p_phone)
    );

    IF v_phone_identity IS NOT NULL AND v_phone_identity <> v_phone THEN
      PERFORM public.upsert_wa_identity_alias(
        v_phone,
        v_phone_identity,
        CASE WHEN public.is_lid_identity(p_phone) THEN 'lid' WHEN p_phone ~* '@(c\.us|s\.whatsapp\.net)' THEN 'jid' ELSE 'unknown' END,
        'unknown',
        p_name,
        'receive_whatsapp_message',
        jsonb_build_object('raw_identity', p_phone, 'wpp_id', v_wpp_id)
      );
    END IF;

    IF v_wpp_identity IS NOT NULL AND v_wpp_identity <> v_phone THEN
      PERFORM public.upsert_wa_identity_alias(
        v_phone,
        v_wpp_identity,
        CASE WHEN public.is_lid_identity(p_wpp_id) THEN 'lid' WHEN p_wpp_id ~* '@(c\.us|s\.whatsapp\.net)' THEN 'jid' ELSE 'unknown' END,
        'unknown',
        p_name,
        'receive_whatsapp_message_id',
        jsonb_build_object('raw_wpp_id', v_wpp_id)
      );
    END IF;
  ELSE
    PERFORM public.upsert_wa_identity_alias(
      v_phone,
      COALESCE(v_phone_identity, p_phone),
      CASE WHEN v_from_lid THEN 'lid' ELSE 'unknown' END,
      'unknown',
      p_name,
      'receive_whatsapp_message_unresolved',
      jsonb_build_object('wpp_id', v_wpp_id, 'identity_unresolved', true)
    );
  END IF;

  v_unresolved := NOT public.is_public_wa_phone(v_phone);

  IF v_wpp_id IS NOT NULL THEN
    SELECT id INTO v_message_id
    FROM public.whatsapp_messages
    WHERE wpp_id = v_wpp_id
       OR external_message_id = v_wpp_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RETURN v_message_id;
    END IF;
  END IF;

  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = v_phone
     OR canonical_phone = v_phone
     OR public.resolve_wa_canonical_phone(phone) = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (
      phone,
      display_name,
      status,
      unread_count,
      canonical_phone,
      identity_type,
      lid_alias,
      external_chat_id,
      sync_status,
      sync_error
    ) VALUES (
      v_phone,
      p_name,
      'open',
      0,
      CASE WHEN public.is_public_wa_phone(v_phone) THEN v_phone ELSE NULL END,
      CASE WHEN v_unresolved THEN 'lid' ELSE 'phone' END,
      CASE WHEN v_from_lid THEN COALESCE(v_phone_identity, v_wpp_identity) ELSE NULL END,
      CASE WHEN v_from_lid THEN COALESCE(v_phone_identity, v_wpp_identity) || '@lid' ELSE v_phone || '@c.us' END,
      'webhook',
      CASE WHEN v_unresolved THEN 'Identity belum terpetakan ke nomor publik' ELSE NULL END
    )
    RETURNING id INTO v_thread_id;
  END IF;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'raw_identity', p_phone,
    'identity_type', CASE WHEN v_from_lid THEN 'lid' WHEN public.is_public_wa_phone(p_phone) THEN 'phone' ELSE 'unknown' END,
    'lid_alias', CASE WHEN v_from_lid THEN COALESCE(v_phone_identity, v_wpp_identity) ELSE NULL END,
    'canonical_phone', CASE WHEN public.is_public_wa_phone(v_phone) THEN v_phone ELSE NULL END,
    'identity_unresolved', v_unresolved,
    'wpp_id', v_wpp_id
  ));

  INSERT INTO public.whatsapp_messages (
    thread_id,
    direction,
    body,
    wpp_id,
    external_message_id,
    external_chat_id,
    from_me,
    metadata
  ) VALUES (
    v_thread_id,
    'in',
    p_body,
    v_wpp_id,
    v_wpp_id,
    CASE WHEN v_from_lid THEN COALESCE(v_phone_identity, v_wpp_identity) || '@lid' ELSE v_phone || '@c.us' END,
    false,
    v_meta
  )
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads
  SET display_name = COALESCE(NULLIF(p_name, ''), display_name),
      phone = v_phone,
      canonical_phone = CASE WHEN public.is_public_wa_phone(v_phone) THEN v_phone ELSE canonical_phone END,
      identity_type = CASE WHEN public.is_public_wa_phone(v_phone) THEN 'phone' ELSE COALESCE(identity_type, 'lid') END,
      lid_alias = COALESCE(CASE WHEN v_from_lid THEN COALESCE(v_phone_identity, v_wpp_identity) END, lid_alias),
      last_message_preview = LEFT(p_body, 120),
      last_message_at = now(),
      unread_count = COALESCE(unread_count, 0) + 1,
      sync_error = CASE WHEN public.is_public_wa_phone(v_phone) THEN NULL ELSE COALESCE(sync_error, 'Identity belum terpetakan ke nomor publik') END
  WHERE id = v_thread_id;

  IF public.is_public_wa_phone(v_phone) THEN
    PERFORM public.merge_wa_threads_to_canonical_phone(v_phone);
  END IF;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(p_phone text, p_name text, p_body text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.receive_whatsapp_message(p_phone, p_name, p_body, NULL::text);
$$;

-- Backfill/repair known aliases: if an old thread is already resolvable, stop showing
-- the LID as the primary phone in admin/correction screens.
WITH resolved AS (
  SELECT id, public.resolve_wa_canonical_phone(phone) AS canonical
  FROM public.whatsapp_threads
)
UPDATE public.whatsapp_threads t
SET phone = r.canonical,
    canonical_phone = r.canonical,
    identity_type = 'phone',
    sync_error = NULL
FROM resolved r
WHERE t.id = r.id
  AND public.is_public_wa_phone(r.canonical)
  AND t.phone IS DISTINCT FROM r.canonical;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT canonical_phone
    FROM public.wa_identity_aliases
    WHERE is_active = true
      AND public.is_public_wa_phone(canonical_phone)
  LOOP
    PERFORM public.merge_wa_threads_to_canonical_phone(r.canonical_phone);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.wa_identity_from_wpp_message_id(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_wa_threads_to_canonical_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
