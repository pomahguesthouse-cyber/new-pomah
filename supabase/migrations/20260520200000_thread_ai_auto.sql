-- Add per-thread AI auto-reply toggle.
-- ai_auto = true  → AI handles replies (default)
-- ai_auto = false → Human has taken over; AI is silenced for this thread

ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS ai_auto boolean NOT NULL DEFAULT true;

-- Update get_autoreply_context to respect the per-thread ai_auto flag.
-- If ai_auto = false the function returns auto_reply_enabled = false
-- regardless of the property-level config.
CREATE OR REPLACE FUNCTION get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_thread_id       uuid;
  v_ai_auto         boolean := true;
  v_auto_reply      boolean := false;
  v_fonnte_token    text    := '';
  v_ai_lab_config   jsonb   := '{}';
  v_smart_delay_cfg jsonb   := NULL;
  v_messages        jsonb   := '[]';
BEGIN
  -- 1. Find the thread for this phone
  SELECT id, ai_auto
  INTO   v_thread_id, v_ai_auto
  FROM   whatsapp_threads
  WHERE  phone = p_phone
  LIMIT  1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Pull property-level settings
  SELECT
    COALESCE(fonnte_token, ''),
    COALESCE(ai_lab_config, '{}'),
    smart_delay_config
  INTO v_fonnte_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
  LIMIT 1;

  -- 3. Resolve auto_reply: property config AND per-thread ai_auto must both be true
  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  ) AND v_ai_auto;

  -- 4. Last 30 messages for this thread (ascending for LLM context)
  SELECT jsonb_agg(
           jsonb_build_object(
             'direction', direction,
             'body',      body
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
    'smart_delay_config', v_smart_delay_cfg
  );
END;
$$;
