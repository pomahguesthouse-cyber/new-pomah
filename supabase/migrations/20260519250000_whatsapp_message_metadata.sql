-- Add per-message metadata for per-bubble AI analysis badges.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- receive_whatsapp_message now returns the new message's uuid so the
-- webhook can immediately attach metadata to it.
DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text,text,text);
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name  text,
  p_body  text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id  uuid;
  v_message_id uuid;
BEGIN
  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads WHERE phone = p_phone LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (phone, display_name, status, unread_count)
    VALUES (p_phone, p_name, 'open', 0)
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.whatsapp_messages (thread_id, direction, body)
  VALUES (v_thread_id, 'in', p_body)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    display_name         = p_name,
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;

  RETURN v_message_id;
END;
$$;

-- save_outbound_whatsapp now accepts optional metadata and returns message id.
DROP FUNCTION IF EXISTS public.save_outbound_whatsapp(uuid,text);
CREATE OR REPLACE FUNCTION public.save_outbound_whatsapp(
  p_thread_id uuid,
  p_body      text,
  p_metadata  jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  INSERT INTO public.whatsapp_messages (thread_id, direction, body, metadata)
  VALUES (p_thread_id, 'out', p_body, p_metadata)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = 0
  WHERE id = p_thread_id;

  RETURN v_message_id;
END;
$$;

-- Save or update metadata on any message.
CREATE OR REPLACE FUNCTION public.save_message_metadata(
  p_message_id uuid,
  p_metadata   jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_messages
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata
  WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message  TO anon;
GRANT EXECUTE ON FUNCTION public.save_outbound_whatsapp    TO anon;
GRANT EXECUTE ON FUNCTION public.save_message_metadata     TO anon;
