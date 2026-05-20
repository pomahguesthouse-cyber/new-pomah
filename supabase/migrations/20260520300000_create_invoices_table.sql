-- Persisted invoice records.
-- Each booking has at most one invoice row (upsert on conflict).
-- The row is created when the PDF is first generated and updated
-- every time the PDF is regenerated (e.g. after payment status changes).

CREATE TABLE IF NOT EXISTS public.invoices (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             UUID        NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  invoice_number         TEXT        NOT NULL,   -- "INV-<reference_code>"
  pdf_url                TEXT,                   -- Supabase Storage public URL
  payment_status_snapshot TEXT,                  -- payment_status at last generation
  wa_sent_at             TIMESTAMPTZ,            -- when WhatsApp was last sent
  issued_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage invoices" ON public.invoices FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Index for fast lookup by booking_id
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON public.invoices(booking_id);

NOTIFY pgrst, 'reload schema';
