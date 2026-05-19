-- SECURITY DEFINER function so the webhook can insert messages
-- using only the anon key (no service_role key required).
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name  text,
  p_body  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id uuid;
  v_guest_id  uuid;
BEGIN
  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = p_phone
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    SELECT id INTO v_guest_id
    FROM public.guests
    WHERE phone = p_phone
    LIMIT 1;

    INSERT INTO public.whatsapp_threads (phone, display_name, guest_id)
    VALUES (p_phone, COALESCE(NULLIF(p_name, ''), p_phone), v_guest_id)
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.whatsapp_messages (thread_id, direction, body)
  VALUES (v_thread_id, 'in', p_body);

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message TO anon;
