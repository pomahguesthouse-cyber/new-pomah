-- Migrate from Fonnte to Meta WhatsApp API
-- Add meta config to properties
ALTER TABLE "public"."properties" ADD COLUMN "meta_access_token" TEXT;
ALTER TABLE "public"."properties" ADD COLUMN "meta_phone_number_id" TEXT;
ALTER TABLE "public"."properties" ADD COLUMN "meta_verify_token" TEXT;

-- Drop fonnte config
ALTER TABLE "public"."properties" DROP COLUMN "fonnte_token";

-- Rename fonnte_id to meta_message_id in whatsapp_messages
ALTER TABLE "public"."whatsapp_messages" RENAME COLUMN "fonnte_id" TO "meta_message_id";

-- Re-create the get_autoreply_context function to use meta tokens instead of fonnte_token
DROP FUNCTION IF EXISTS public.get_autoreply_context(text);

CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_thread_id       uuid;
  v_ai_auto         boolean := true;
  v_auto_reply      boolean := false;
  v_meta_access_token    text := '';
  v_meta_phone_number_id text := '';
  v_ai_lab_config   jsonb := '{}';
  v_messages        jsonb := '[]';
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
    COALESCE(meta_access_token, ''),
    COALESCE(meta_phone_number_id, ''),
    COALESCE(ai_lab_config, '{}')
  INTO v_meta_access_token, v_meta_phone_number_id, v_ai_lab_config
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
      AND  deleted_at IS NULL
    ORDER  BY sent_at DESC
    LIMIT  30
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',            v_thread_id,
    'auto_reply_enabled',   v_auto_reply,
    'meta_access_token',    v_meta_access_token,
    'meta_phone_number_id', v_meta_phone_number_id,
    'messages',             COALESCE(v_messages, '[]'::jsonb)
  );
END;
$$;
