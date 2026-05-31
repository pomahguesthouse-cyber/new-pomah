-- Migration: Add chat_summary to whatsapp_threads and update get_autoreply_context

-- 1. Add chat_summary column to whatsapp_threads if it doesn't exist
ALTER TABLE public.whatsapp_threads ADD COLUMN IF NOT EXISTS chat_summary TEXT DEFAULT '';

-- 2. Update get_autoreply_context RPC function to return chat_summary and include sent_at in messages
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id       uuid;
  v_ai_auto         boolean := true;
  v_auto_reply      boolean := false;
  v_fonnte_token    text    := '';
  v_ai_lab_config   jsonb   := '{}';
  v_smart_delay_cfg jsonb   := NULL;
  v_chat_summary    text    := '';
  v_messages        jsonb   := '[]';
BEGIN
  SELECT id, ai_auto, COALESCE(chat_summary, '')
  INTO   v_thread_id, v_ai_auto, v_chat_summary
  FROM   whatsapp_threads
  WHERE  phone = p_phone
  LIMIT  1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(fonnte_token, ''),
    COALESCE(ai_lab_config, '{}'),
    smart_delay_config
  INTO v_fonnte_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
  LIMIT 1;

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  ) AND v_ai_auto;

  SELECT jsonb_agg(
           jsonb_build_object(
             'direction', direction,
             'body',      body,
             'sent_at',   sent_at
           ) ORDER BY sent_at ASC
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
    'thread_id',          v_thread_id,
    'auto_reply_enabled', v_auto_reply,
    'fonnte_token',       v_fonnte_token,
    'messages',           COALESCE(v_messages, '[]'::jsonb),
    'smart_delay_config', v_smart_delay_cfg,
    'chat_summary',       v_chat_summary
  );
END;
$$;

-- 3. Match the security posture: service role only
REVOKE EXECUTE ON FUNCTION public.get_autoreply_context(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO service_role;
