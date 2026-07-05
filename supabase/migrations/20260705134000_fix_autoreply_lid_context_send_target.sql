-- Fix autoreply for unresolved WhatsApp LID conversations.
-- The worker may receive either a public phone (62xxx) or a LID-only value.
-- This RPC now resolves aliases, finds the matching thread by phone/canonical/LID,
-- and returns a send_target that can be the original external_chat_id such as ...@lid.

CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_identity                text := public.normalize_wa_identity(p_phone);
  v_canonical               text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id               uuid;
  v_thread_phone            text;
  v_thread_canonical        text;
  v_external_chat_id        text;
  v_lid_alias               text;
  v_send_target             text;
  v_ai_auto                 boolean := true;
  v_auto_reply              boolean := false;
  v_wpp_token               text    := '';
  v_ai_lab_config           jsonb   := '{}';
  v_smart_delay_cfg         jsonb   := NULL;
  v_chat_summary            text    := '';
  v_chat_summary_json       jsonb   := '{}'::jsonb;
  v_chat_summary_version    integer := 1;
  v_chat_summary_updated_at timestamptz;
  v_messages                jsonb   := '[]';
BEGIN
  SELECT id,
         phone,
         canonical_phone,
         external_chat_id,
         lid_alias,
         ai_auto,
         COALESCE(chat_summary, ''),
         COALESCE(chat_summary_json, '{}'::jsonb),
         COALESCE(chat_summary_version, 1),
         chat_summary_updated_at
    INTO v_thread_id,
         v_thread_phone,
         v_thread_canonical,
         v_external_chat_id,
         v_lid_alias,
         v_ai_auto,
         v_chat_summary,
         v_chat_summary_json,
         v_chat_summary_version,
         v_chat_summary_updated_at
  FROM public.whatsapp_threads wt
  WHERE wt.phone IN (p_phone, v_identity, v_canonical)
     OR wt.canonical_phone IN (p_phone, v_identity, v_canonical)
     OR public.normalize_wa_identity(wt.external_chat_id) IN (v_identity, v_canonical)
     OR public.normalize_wa_identity(wt.lid_alias) IN (v_identity, v_canonical)
  ORDER BY
    CASE WHEN public.normalize_wa_identity(wt.phone) = v_canonical THEN 0 ELSE 1 END,
    wt.last_message_at DESC NULLS LAST,
    wt.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_canonical IS NULL THEN
    v_canonical := public.resolve_wa_canonical_phone(v_thread_phone);
  END IF;

  v_send_target := COALESCE(NULLIF(v_external_chat_id, ''), NULLIF(v_thread_canonical, ''), NULLIF(v_canonical, ''), NULLIF(v_thread_phone, ''), p_phone);

  -- If the best available identity is a bare LID number, restore @lid for WPPConnect send APIs.
  IF v_send_target ~ '^[0-9]{10,18}$' AND v_send_target !~ '^62[0-9]{8,14}$' THEN
    v_send_target := v_send_target || '@lid';
  END IF;

  SELECT COALESCE(wpp_token, ''),
         COALESCE(ai_lab_config, '{}'),
         smart_delay_config
    INTO v_wpp_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
  LIMIT 1;

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  ) AND v_ai_auto;

  SELECT jsonb_agg(
           jsonb_build_object('direction', direction, 'body', body, 'sent_at', sent_at)
           ORDER BY sent_at ASC
         )
    INTO v_messages
  FROM (
    SELECT direction, body, sent_at
    FROM   whatsapp_messages
    WHERE  thread_id = v_thread_id
    ORDER  BY sent_at DESC
    LIMIT  30
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',               v_thread_id,
    'thread_phone',            v_thread_phone,
    'canonical_phone',         v_canonical,
    'external_chat_id',        v_external_chat_id,
    'lid_alias',               v_lid_alias,
    'send_target',             v_send_target,
    'auto_reply_enabled',      v_auto_reply,
    'wpp_token',               v_wpp_token,
    'messages',                COALESCE(v_messages, '[]'::jsonb),
    'smart_delay_config',      v_smart_delay_cfg,
    'chat_summary',            v_chat_summary,
    'chat_summary_json',       v_chat_summary_json,
    'chat_summary_version',    v_chat_summary_version,
    'chat_summary_updated_at', v_chat_summary_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
