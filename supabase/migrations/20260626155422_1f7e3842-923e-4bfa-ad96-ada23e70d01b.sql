
CREATE TABLE public.booking_form_send_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  phone text NOT NULL,
  thread_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  room_type_name text,
  check_in date,
  check_out date,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','superseded')),
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bf_send_logs_phone ON public.booking_form_send_logs(phone);
CREATE INDEX idx_bf_send_logs_token ON public.booking_form_send_logs(token);
CREATE INDEX idx_bf_send_logs_status_created ON public.booking_form_send_logs(status, created_at DESC);
CREATE INDEX idx_bf_send_logs_created ON public.booking_form_send_logs(created_at DESC);

GRANT SELECT ON public.booking_form_send_logs TO authenticated;
GRANT ALL ON public.booking_form_send_logs TO service_role;

ALTER TABLE public.booking_form_send_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated dapat membaca semua log"
  ON public.booking_form_send_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.touch_booking_form_send_logs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_form_send_logs_updated_at
BEFORE UPDATE ON public.booking_form_send_logs
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_form_send_logs_updated_at();
