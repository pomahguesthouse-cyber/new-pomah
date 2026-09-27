-- Staff phone push tokens and side-effect notifications.
-- Does not change booking totals, availability, or WhatsApp auto-reply.
--
-- After applying this file, the owner still has to:
-- 1. Deploy supabase/functions/send-staff-push with JWT verification off.
-- 2. Set the function secrets FCM_SERVICE_ACCOUNT_JSON and PUSH_WEBHOOK_SECRET.
-- 3. Insert the same webhook secret (see the comment at the bottom). Until that
--    row exists, the triggers no-op.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_tokens_token_key UNIQUE (token),
  CONSTRAINT device_tokens_token_len CHECK (char_length(token) BETWEEN 20 AND 4096)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON public.device_tokens (user_id);

DROP TRIGGER IF EXISTS trg_device_tokens_updated ON public.device_tokens;
CREATE TRIGGER trg_device_tokens_updated
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_select ON public.device_tokens;
CREATE POLICY device_tokens_select
  ON public.device_tokens
  FOR SELECT
  TO authenticated
  USING (
    public.is_staff(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

DROP POLICY IF EXISTS device_tokens_insert ON public.device_tokens;
CREATE POLICY device_tokens_insert
  ON public.device_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

DROP POLICY IF EXISTS device_tokens_update ON public.device_tokens;
CREATE POLICY device_tokens_update
  ON public.device_tokens
  FOR UPDATE
  TO authenticated
  USING (
    public.is_staff(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  WITH CHECK (
    public.is_staff(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

DROP POLICY IF EXISTS device_tokens_delete ON public.device_tokens;
CREATE POLICY device_tokens_delete
  ON public.device_tokens
  FOR DELETE
  TO authenticated
  USING (
    public.is_staff(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;

-- Secret for the edge function. No policies: only the table owner (the
-- SECURITY DEFINER trigger) can read it. Do not put the secret in this file.
CREATE TABLE IF NOT EXISTS public.staff_push_config (
  id integer PRIMARY KEY CHECK (id = 1),
  webhook_secret text,
  function_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_push_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_device_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.is_staff(uid) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('android', 'ios', 'web') THEN
    RAISE EXCEPTION 'invalid platform';
  END IF;
  IF p_token IS NULL OR char_length(p_token) < 20 OR char_length(p_token) > 4096 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  INSERT INTO public.device_tokens (user_id, token, platform)
  VALUES (uid, p_token, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_device_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR p_token IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.device_tokens
  WHERE token = p_token
    AND user_id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unregister_device_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_device_token(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_staff_push(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT webhook_secret, function_url
    INTO v_secret, v_url
  FROM public.staff_push_config
  WHERE id = 1;

  IF v_secret IS NULL OR char_length(v_secret) < 16 THEN
    RETURN;
  END IF;

  v_url := COALESCE(
    NULLIF(v_url, ''),
    'https://gofvxeiulaljwyfyhnww.supabase.co/functions/v1/send-staff-push'
  );

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := p_payload,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_staff_push skipped: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_staff_push(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_staff_push_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_phone text;
  v_preview text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'in' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.from_me, false) OR COALESCE(NEW.ai_draft, false) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.source, 'webhook') IN ('sync', 'wpp_sync', 'history', 'mirror', 'backfill') THEN
    RETURN NEW;
  END IF;
  IF NEW.sent_at IS NOT NULL AND NEW.sent_at < now() - interval '30 minutes' THEN
    RETURN NEW;
  END IF;

  SELECT display_name, phone INTO v_name, v_phone
  FROM public.whatsapp_threads
  WHERE id = NEW.thread_id;

  v_preview := left(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'), 140);

  PERFORM public.enqueue_staff_push(jsonb_build_object(
    'kind', 'whatsapp',
    'title', 'Pesan WhatsApp baru',
    'body', left(COALESCE(NULLIF(v_name, ''), NULLIF(v_phone, ''), 'Tamu'), 80) || ': ' || v_preview,
    'url', '/admin/whatsapp?thread=' || NEW.thread_id::text,
    'thread_id', NEW.thread_id::text,
    'message_id', NEW.id::text
  ));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_staff_push_whatsapp skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_push_whatsapp_inbound ON public.whatsapp_messages;
CREATE TRIGGER trg_staff_push_whatsapp_inbound
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_staff_push_whatsapp();

CREATE OR REPLACE FUNCTION public.notify_staff_push_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT full_name INTO v_name
  FROM public.guests
  WHERE id = NEW.guest_id;

  PERFORM public.enqueue_staff_push(jsonb_build_object(
    'kind', 'booking',
    'title', 'Booking baru',
    'body', COALESCE(NEW.reference_code, 'Booking') || ' · ' || COALESCE(NULLIF(v_name, ''), 'Tamu'),
    'url', '/admin/bookings?booking=' || NEW.id::text,
    'booking_id', NEW.id::text
  ));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_staff_push_booking skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_push_booking_insert ON public.bookings;
CREATE TRIGGER trg_staff_push_booking_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_staff_push_booking();

REVOKE ALL ON FUNCTION public.notify_staff_push_whatsapp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_staff_push_booking() FROM PUBLIC, anon, authenticated;

-- Owner step (run in the SQL editor, do not commit the secret):
-- insert into public.staff_push_config (id, webhook_secret)
-- values (1, '<same value as the PUSH_WEBHOOK_SECRET function secret>')
-- on conflict (id) do update
--   set webhook_secret = excluded.webhook_secret,
--       updated_at = now();

NOTIFY pgrst, 'reload schema';
