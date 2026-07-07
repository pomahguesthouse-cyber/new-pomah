-- Human-takeover timed auto-pause.
--
-- When a human replies (native from the operator's phone, or manually via the
-- admin inbox), the app sets whatsapp_threads.ai_paused_until = now() + N minutes.
-- While that timestamp is in the future, get_autoreply_context reports
-- auto_reply_enabled = false, so the AI stays silent. Once it passes, the AI
-- resumes automatically (no manual un-pause needed). Sliding window: each new
-- human reply pushes ai_paused_until forward again.
--
-- The pause duration (minutes) is stored in properties.ai_lab_config.humanTakeover
-- and is adjustable from the AI Lab settings UI. This migration only adds the
-- column and the gate; it does not force any value.

-- 1) Column (idempotent).
ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS ai_paused_until timestamptz;

-- 2) Recreate get_autoreply_context: identical to the current version, plus a
--    read of ai_paused_until and an extra condition on v_auto_reply.
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
  v_ai_paused_until         timestamptz;
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
         ai_paused_until,
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
         v_ai_paused_until,
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
  )
  AND v_ai_auto
  AND (v_ai_paused_until IS NULL OR now() >= v_ai_paused_until);

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
    'ai_paused_until',         v_ai_paused_until,
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
