
CREATE TABLE IF NOT EXISTS public.webchat_threads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name            text,
  guest_phone           text,
  guest_email           text,
  booking_id            uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_code          text,
  whatsapp_thread_id    uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','waiting_admin','ai_active','closed')),
  source                text NOT NULL DEFAULT 'webchat_backup',
  handoff_status        text NOT NULL DEFAULT 'ai'
                          CHECK (handoff_status IN ('ai','human','paused')),
  handoff_until         timestamptz,
  context_summary       text NOT NULL DEFAULT '',
  context_summary_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webchat_threads TO authenticated;
GRANT ALL ON public.webchat_threads TO service_role;

ALTER TABLE public.webchat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage webchat threads"
  ON public.webchat_threads FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS webchat_threads_last_msg_idx ON public.webchat_threads (last_message_at DESC);
CREATE INDEX IF NOT EXISTS webchat_threads_status_idx   ON public.webchat_threads (status);
CREATE INDEX IF NOT EXISTS webchat_threads_phone_idx    ON public.webchat_threads (guest_phone);

CREATE TABLE IF NOT EXISTS public.webchat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES public.webchat_threads(id) ON DELETE CASCADE,
  sender_type     text NOT NULL CHECK (sender_type IN ('guest','bot','admin','system')),
  sender_name     text,
  body            text,
  attachment_url  text,
  attachment_type text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webchat_messages TO authenticated;
GRANT ALL ON public.webchat_messages TO service_role;

ALTER TABLE public.webchat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage webchat messages"
  ON public.webchat_messages FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS webchat_messages_thread_time_idx
  ON public.webchat_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.channel_status (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'online'
                        CHECK (status IN ('online','degraded','offline')),
  last_ok_at          timestamptz,
  last_error_at       timestamptz,
  last_error_message  text,
  fallback_enabled    boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.channel_status TO anon, authenticated;
GRANT ALL ON public.channel_status TO service_role;

ALTER TABLE public.channel_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone read channel status"
  ON public.channel_status FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admin write channel status"
  ON public.channel_status FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.channel_status (channel, status, last_ok_at) VALUES
  ('whatsapp_fonnte','online', now()),
  ('webchat','online', now())
ON CONFLICT (channel) DO NOTHING;

DROP TRIGGER IF EXISTS webchat_threads_updated_at ON public.webchat_threads;
CREATE TRIGGER webchat_threads_updated_at BEFORE UPDATE ON public.webchat_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS channel_status_updated_at ON public.channel_status;
CREATE TRIGGER channel_status_updated_at BEFORE UPDATE ON public.channel_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
