-- Push delivery is admin and manager only.
-- register_device_token is intentionally unchanged: any is_staff caller
-- (admin, staff, or manager) may store a token. Only admin and manager
-- tokens are selected when a push is sent.
-- Does not change booking totals, availability, or WhatsApp auto-reply.

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('admin', 'staff', 'manager')
  )
$$;

REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.register_device_token(text, text) IS
  'Any is_staff caller (admin, staff, or manager) may register a device token. Pushes are delivered only to admin and manager tokens.';

-- Android tokens whose user has role admin or manager.
-- p_user_ids null: every such token. A non-null array intersects that set,
-- so a staff-only id in the enqueue payload is dropped.
CREATE OR REPLACE FUNCTION public.list_staff_push_tokens(p_user_ids uuid[] DEFAULT NULL)
RETURNS TABLE (token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT dt.token
  FROM public.device_tokens dt
  JOIN public.user_roles ur ON ur.user_id = dt.user_id
  WHERE dt.platform = 'android'
    AND ur.role::text IN ('admin', 'manager')
    AND (p_user_ids IS NULL OR dt.user_id = ANY (p_user_ids))
$$;

REVOKE ALL ON FUNCTION public.list_staff_push_tokens(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff_push_tokens(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_staff_push(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_recipients jsonb;
  v_body jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(DISTINCT dt.user_id), '[]'::jsonb)
    INTO v_recipients
  FROM public.device_tokens dt
  JOIN public.user_roles ur ON ur.user_id = dt.user_id
  WHERE ur.role::text IN ('admin', 'manager');

  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN;
  END IF;

  v_body := COALESCE(p_payload, '{}'::jsonb)
    || jsonb_build_object('recipient_user_ids', v_recipients);

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
    body := v_body,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_staff_push skipped: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_staff_push(jsonb) FROM PUBLIC, anon, authenticated;

-- At most one WhatsApp push per thread per 30 seconds.
CREATE TABLE IF NOT EXISTS public.staff_push_throttle (
  thread_id uuid PRIMARY KEY REFERENCES public.whatsapp_threads(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_push_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_push_throttle FROM PUBLIC, anon, authenticated;

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
  v_allowed boolean;
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
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  WITH claim AS (
    INSERT INTO public.staff_push_throttle (thread_id, last_sent_at)
    VALUES (NEW.thread_id, now())
    ON CONFLICT (thread_id) DO UPDATE
      SET last_sent_at = EXCLUDED.last_sent_at
      WHERE public.staff_push_throttle.last_sent_at <= now() - interval '30 seconds'
    RETURNING thread_id
  )
  SELECT EXISTS (SELECT 1 FROM claim) INTO v_allowed;

  IF NOT v_allowed THEN
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

-- Staff-created bookings intentionally push. Every bookings insert notifies
-- admin and manager devices; there is no source filter.
CREATE OR REPLACE FUNCTION public.notify_staff_push_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  -- Staff-created bookings intentionally push. There is no source filter.
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

REVOKE ALL ON FUNCTION public.notify_staff_push_whatsapp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_staff_push_booking() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
