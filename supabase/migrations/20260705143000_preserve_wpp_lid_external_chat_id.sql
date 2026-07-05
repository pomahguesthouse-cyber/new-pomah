-- Preserve the raw WPPConnect chat id for LID conversations.
--
-- The 4-arg receive_whatsapp_message RPC can store a bare non-62 identity as
-- if it were a normal @c.us target. The app now passes p_external_chat_id
-- (for example 4114662604939@lid), and this wrapper keeps that exact target so
-- autoreply can send back through WPPConnect while the public phone is unknown.

CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name text,
  p_body text,
  p_wpp_id text,
  p_external_chat_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_id uuid;
  v_thread_id uuid;
  v_external_raw text := NULLIF(btrim(coalesce(p_external_chat_id, '')), '');
  v_external_identity text := public.normalize_wa_identity(v_external_raw);
  v_canonical text := public.resolve_wa_canonical_phone(coalesce(v_external_raw, p_phone));
  v_is_public boolean := public.is_public_wa_phone(v_canonical);
  v_is_lid boolean := public.is_lid_identity(v_external_raw)
    OR (v_external_identity IS NOT NULL AND NOT public.is_public_wa_phone(v_external_identity));
BEGIN
  v_message_id := public.receive_whatsapp_message(p_phone, p_name, p_body, p_wpp_id);

  IF v_message_id IS NULL OR v_external_raw IS NULL THEN
    RETURN v_message_id;
  END IF;

  SELECT thread_id INTO v_thread_id
  FROM public.whatsapp_messages
  WHERE id = v_message_id;

  UPDATE public.whatsapp_messages
  SET external_chat_id = v_external_raw,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'external_chat_id', v_external_raw,
        'lid_alias', CASE WHEN v_is_lid THEN v_external_identity ELSE NULL END,
        'canonical_phone', CASE WHEN v_is_public THEN v_canonical ELSE NULL END,
        'identity_unresolved', NOT v_is_public
      ))
  WHERE id = v_message_id;

  IF v_thread_id IS NOT NULL THEN
    UPDATE public.whatsapp_threads
    SET external_chat_id = v_external_raw,
        lid_alias = COALESCE(CASE WHEN v_is_lid THEN v_external_identity END, lid_alias),
        canonical_phone = CASE WHEN v_is_public THEN v_canonical ELSE canonical_phone END,
        phone = CASE WHEN v_is_public THEN v_canonical ELSE phone END,
        identity_type = CASE WHEN v_is_public THEN 'phone' WHEN v_is_lid THEN 'lid' ELSE identity_type END,
        sync_error = CASE WHEN v_is_public THEN NULL ELSE COALESCE(sync_error, 'Identity belum terpetakan ke nomor publik') END
    WHERE id = v_thread_id;
  END IF;

  IF v_is_public THEN
    PERFORM public.merge_wa_threads_to_canonical_phone(v_canonical);
  END IF;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text, text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
