-- Returns everything the webhook needs to generate an auto-reply:
-- fonnte_token, auto_reply flag, AI instructions, and last 20 messages.
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id        uuid;
  v_fonnte_token     text;
  v_ai_lab_config    jsonb;
  v_auto_reply       boolean;
  v_instructions     text;
  v_messages         jsonb;
BEGIN
  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads WHERE phone = p_phone LIMIT 1;

  IF v_thread_id IS NULL THEN RETURN NULL; END IF;

  SELECT fonnte_token,
         (ai_lab_config::jsonb)
  INTO   v_fonnte_token, v_ai_lab_config
  FROM   public.properties LIMIT 1;

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  );

  v_instructions := COALESCE(
    NULLIF(v_ai_lab_config -> 'agents' -> 'front-office' ->> 'instructions', ''),
    'Anda front-desk Pomah Guesthouse. Balas tamu dengan hangat, singkat (2-4 kalimat), dan profesional. Gunakan bahasa yang sama dengan tamu. Jangan mengarang harga atau ketersediaan kamar — tawarkan untuk mengeceknya.'
  );

  SELECT jsonb_agg(
           jsonb_build_object('direction', direction, 'body', body)
           ORDER BY sent_at
         )
  INTO v_messages
  FROM (
    SELECT direction, body, sent_at
    FROM   public.whatsapp_messages
    WHERE  thread_id = v_thread_id
    ORDER  BY sent_at DESC
    LIMIT  20
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',          v_thread_id,
    'fonnte_token',       v_fonnte_token,
    'auto_reply_enabled', v_auto_reply,
    'instructions',       v_instructions,
    'messages',           COALESCE(v_messages, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_autoreply_context TO anon;

-- Saves an outbound (bot) message and updates thread preview.
CREATE OR REPLACE FUNCTION public.save_outbound_whatsapp(
  p_thread_id uuid,
  p_body      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.whatsapp_messages (thread_id, direction, body)
  VALUES (p_thread_id, 'out', p_body);

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = 0
  WHERE id = p_thread_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_outbound_whatsapp TO anon;
