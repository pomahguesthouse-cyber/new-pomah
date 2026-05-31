-- Manager notifications & escalation system

-- 1. Extend property_managers with active flag
ALTER TABLE public.property_managers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. notification_logs
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL CHECK (event_type IN ('new_booking', 'payment_proof', 'complaint')),
  recipient_phone text NOT NULL,
  recipient_role  text,
  message         text NOT NULL,
  attachment_url  text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  error           text,
  dedupe_key      text UNIQUE,
  related_id      uuid,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage notification_logs"
  ON public.notification_logs
  FOR ALL
  TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON public.notification_logs (created_at DESC);

-- 3. guest_complaints
CREATE TABLE IF NOT EXISTS public.guest_complaints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name   text,
  phone        text NOT NULL,
  thread_id    uuid,
  booking_id   uuid,
  category     text NOT NULL,
  message      text NOT NULL,
  confidence   numeric,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  assigned_to  uuid,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_complaints TO authenticated;
GRANT ALL ON public.guest_complaints TO service_role;

ALTER TABLE public.guest_complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage guest_complaints"
  ON public.guest_complaints
  FOR ALL
  TO authenticated
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_guest_complaints_status
  ON public.guest_complaints (status, created_at DESC);

CREATE TRIGGER trg_guest_complaints_updated_at
  BEFORE UPDATE ON public.guest_complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();