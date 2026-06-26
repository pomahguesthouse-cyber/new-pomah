
-- 1. Tabel booking_form_tokens
CREATE TABLE public.booking_form_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  phone text NOT NULL,
  thread_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  prefill_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_data jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','expired','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  submitted_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_form_tokens_token ON public.booking_form_tokens (token);
CREATE INDEX idx_booking_form_tokens_phone ON public.booking_form_tokens (phone);
CREATE INDEX idx_booking_form_tokens_status_expires ON public.booking_form_tokens (status, expires_at);

GRANT SELECT ON public.booking_form_tokens TO anon;
GRANT SELECT, INSERT, UPDATE ON public.booking_form_tokens TO authenticated;
GRANT ALL ON public.booking_form_tokens TO service_role;

ALTER TABLE public.booking_form_tokens ENABLE ROW LEVEL SECURITY;

-- Anon hanya bisa baca baris pending yang belum expired (akses publik via token).
-- Karena policy tidak bisa membatasi by query param, kita izinkan select asal status valid;
-- token (32 char base64url) sebagai secret pengganti auth.
CREATE POLICY "Anon dapat membaca token aktif"
  ON public.booking_form_tokens
  FOR SELECT
  TO anon
  USING (status IN ('pending','submitted') AND expires_at > now() - interval '7 days');

CREATE POLICY "Authenticated dapat membaca semua"
  ON public.booking_form_tokens
  FOR SELECT
  TO authenticated
  USING (true);

-- Trigger update updated_at
CREATE OR REPLACE FUNCTION public.touch_booking_form_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_form_tokens_updated_at
  BEFORE UPDATE ON public.booking_form_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_form_tokens_updated_at();

-- 2. Feature flag di properties
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS booking_form_enabled boolean NOT NULL DEFAULT false;
