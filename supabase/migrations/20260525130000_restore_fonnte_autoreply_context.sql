-- Restore Fonnte configuration and get_autoreply_context.
--
-- An earlier migration (20260523000000_migrate_fonnte_to_meta) attempted to
-- switch the project from Fonnte to the Meta WhatsApp API, but the application
-- code never moved off Fonnte. That migration has been removed from the repo;
-- this migration guarantees the database is in a consistent Fonnte state and
-- that get_autoreply_context returns `fonnte_token` (which the webhook reads).
--
-- All statements are idempotent so this is safe whether or not the abandoned
-- Meta migration was ever applied to a given database.

-- 1) Properties: ensure fonnte_token exists, drop any leftover Meta columns.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS fonnte_token text;
ALTER TABLE public.properties DROP COLUMN IF EXISTS meta_access_token;
ALTER TABLE public.properties DROP COLUMN IF EXISTS meta_phone_number_id;
ALTER TABLE public.properties DROP COLUMN IF EXISTS meta_verify_token;

-- 2) whatsapp_messages: restore fonnte_id (renamed to meta_message_id by the
--    abandoned migration). Rename back if needed, otherwise ensure it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
      AND column_name = 'meta_message_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
      AND column_name = 'fonnte_id'
  ) THEN
    ALTER TABLE public.whatsapp_messages RENAME COLUMN meta_message_id TO fonnte_id;
  END IF;
END $$;

ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS fonnte_id text;

-- 3) Recreate get_autoreply_context returning fonnte_token (Fonnte version).
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
  v_messages        jsonb   := '[]';
BEGIN
  SELECT id, ai_auto
  INTO   v_thread_id, v_ai_auto
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

-- 4) Match the security posture from 20260525034104: service role only.
REVOKE EXECUTE ON FUNCTION public.get_autoreply_context(text) FROM anon, authenticated;
