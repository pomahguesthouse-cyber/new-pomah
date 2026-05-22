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
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_thread_id uuid;
  v_auto_reply_enabled boolean;
  v_meta_access_token text;
  v_meta_phone_number_id text;
  v_messages json;
BEGIN
  -- 1) Find active thread
  SELECT id, auto_reply_enabled
  INTO v_thread_id, v_auto_reply_enabled
  FROM public.whatsapp_threads
  WHERE phone = p_phone
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) Fetch Meta config from the first property (assumes single tenant)
  SELECT meta_access_token, meta_phone_number_id
  INTO v_meta_access_token, v_meta_phone_number_id
  FROM public.properties
  LIMIT 1;

  -- 3) Fetch recent messages (limit 40)
  SELECT COALESCE(json_agg(msg), '[]'::json)
  INTO v_messages
  FROM (
    SELECT direction, body
    FROM public.whatsapp_messages
    WHERE thread_id = v_thread_id
      AND deleted_at IS NULL
    ORDER BY sent_at ASC
    LIMIT 40
  ) msg;

  -- Return payload
  RETURN json_build_object(
    'thread_id', v_thread_id,
    'auto_reply_enabled', COALESCE(v_auto_reply_enabled, false),
    'meta_access_token', v_meta_access_token,
    'meta_phone_number_id', v_meta_phone_number_id,
    'messages', v_messages
  );
END;
$function$;
