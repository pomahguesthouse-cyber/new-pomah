
-- 1. Drop sync triggers + fungsi (CASCADE utk lepaskan dependency trigger).
DROP TRIGGER IF EXISTS trg_sync_properties_wpp_token     ON public.properties;
DROP TRIGGER IF EXISTS trg_sync_whatsapp_messages_wpp_id ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS public.sync_properties_wpp_token()          CASCADE;
DROP FUNCTION IF EXISTS public.sync_whatsapp_messages_wpp_id()      CASCADE;

-- 2. Recreate save_outbound_whatsapp: hanya param p_wpp_id.
DROP FUNCTION IF EXISTS public.save_outbound_whatsapp(uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public.save_outbound_whatsapp(uuid, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.save_outbound_whatsapp(
  p_thread_id uuid,
  p_body      text,
  p_metadata  jsonb DEFAULT NULL,
  p_wpp_id    text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  INSERT INTO public.whatsapp_messages (thread_id, direction, body, metadata, wpp_id)
  VALUES (p_thread_id, 'out', p_body, p_metadata, p_wpp_id)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = 0
  WHERE id = p_thread_id;

  RETURN v_message_id;
END;
$$;

-- 3. get_autoreply_context: buang key fonnte_token.
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_thread_id               uuid;
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
  SELECT id, ai_auto,
         COALESCE(chat_summary, ''),
         COALESCE(chat_summary_json, '{}'::jsonb),
         COALESCE(chat_summary_version, 1),
         chat_summary_updated_at
    INTO v_thread_id, v_ai_auto,
         v_chat_summary, v_chat_summary_json,
         v_chat_summary_version, v_chat_summary_updated_at
  FROM whatsapp_threads
  WHERE phone = p_phone
  LIMIT 1;

  IF v_thread_id IS NULL THEN RETURN NULL; END IF;

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

-- 4. get_public_property: strip wpp_token (kolom fonnte_token tidak ada lagi).
CREATE OR REPLACE FUNCTION public.get_public_property()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT to_jsonb(p)
       - 'google_places_api_key'
       - 'ai_api_key'
       - 'ai_base_url'
       - 'ai_model'
       - 'ai_lab_config'
       - 'wpp_token'
       - 'smart_delay_config'
       - 'payment_bank_name'
       - 'payment_account_number'
       - 'payment_account_holder'
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

-- 5. Drop kolom lama.
ALTER TABLE public.properties        DROP COLUMN IF EXISTS fonnte_token;
ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS fonnte_id;
