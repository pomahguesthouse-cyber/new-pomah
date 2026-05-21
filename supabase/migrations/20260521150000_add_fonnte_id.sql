-- Add fonnte_id to whatsapp_messages table
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS fonnte_id TEXT;

-- Update save_outbound_whatsapp to accept p_fonnte_id
DO $$ BEGIN DROP FUNCTION IF EXISTS public.save_outbound_whatsapp(uuid,text,jsonb); EXCEPTION WHEN undefined_function THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.save_outbound_whatsapp(
  p_thread_id uuid,
  p_body      text,
  p_metadata  jsonb DEFAULT NULL,
  p_fonnte_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  INSERT INTO public.whatsapp_messages (thread_id, direction, body, metadata, fonnte_id)
  VALUES (p_thread_id, 'out', p_body, p_metadata, p_fonnte_id)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = 0
  WHERE id = p_thread_id;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_outbound_whatsapp TO anon;
