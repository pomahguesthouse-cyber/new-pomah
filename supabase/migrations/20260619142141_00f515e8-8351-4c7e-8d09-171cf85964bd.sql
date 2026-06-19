
CREATE TYPE public.handoff_ticket_status AS ENUM (
  'open', 'approved', 'adjusted', 'cancelled', 'resolved'
);

CREATE TABLE public.handoff_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  thread_id UUID NULL,
  booking_code TEXT NULL,
  booking_summary TEXT NOT NULL DEFAULT '',
  booking_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  frustration_kind TEXT NOT NULL,
  frustration_score INTEGER NOT NULL DEFAULT 0,
  trigger_message TEXT NOT NULL DEFAULT '',
  status public.handoff_ticket_status NOT NULL DEFAULT 'open',
  assigned_to UUID NULL,
  resolution_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_handoff_tickets_status ON public.handoff_tickets(status, created_at DESC);
CREATE INDEX idx_handoff_tickets_phone ON public.handoff_tickets(phone, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.handoff_tickets TO authenticated;
GRANT ALL ON public.handoff_tickets TO service_role;

ALTER TABLE public.handoff_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage handoff tickets"
ON public.handoff_tickets
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_handoff_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status <> OLD.status AND NEW.status <> 'open' AND OLD.status = 'open' THEN
    NEW.resolved_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_handoff_tickets_updated_at
BEFORE UPDATE ON public.handoff_tickets
FOR EACH ROW EXECUTE FUNCTION public.set_handoff_tickets_updated_at();
