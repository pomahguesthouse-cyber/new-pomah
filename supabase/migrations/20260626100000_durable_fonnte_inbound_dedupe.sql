-- Durable inbound deduplication for Fonnte webhooks.
-- The previous in-memory guard can miss duplicates on Cloudflare Workers
-- because different requests may land in different isolates.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS fonnte_id text;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY fonnte_id
      ORDER BY sent_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.whatsapp_messages
  WHERE fonnte_id IS NOT NULL
)
UPDATE public.whatsapp_messages m
SET fonnte_id = NULL
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_fonnte_id_unique
  ON public.whatsapp_messages (fonnte_id)
  WHERE fonnte_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone     text,
  p_name      text,
  p_body      text,
  p_fonnte_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id  uuid;
  v_message_id uuid;
  v_fonnte_id  text := NULLIF(btrim(p_fonnte_id), '');
BEGIN
  IF v_fonnte_id IS NOT NULL THEN
    SELECT id INTO v_message_id
    FROM public.whatsapp_messages
    WHERE fonnte_id = v_fonnte_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RETURN v_message_id;
    END IF;
  END IF;

  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = p_phone
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (phone, display_name, status, unread_count)
    VALUES (p_phone, p_name, 'open', 0)
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.whatsapp_messages (thread_id, direction, body, fonnte_id)
  VALUES (v_thread_id, 'in', p_body, v_fonnte_id)
  ON CONFLICT (fonnte_id) WHERE fonnte_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL AND v_fonnte_id IS NOT NULL THEN
    SELECT id INTO v_message_id
    FROM public.whatsapp_messages
    WHERE fonnte_id = v_fonnte_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RETURN v_message_id;
    END IF;
  END IF;

  UPDATE public.whatsapp_threads SET
    display_name         = p_name,
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text,text,text,text) TO anon;
