-- Draft booking dari bot WhatsApp: disimpan SEBELUM write final ke tabel
-- bookings, supaya data pesanan tidak hilang bila write gagal / koneksi putus.
-- Status: draft → completed (booking tercatat) | failed (dibiarkan untuk staf).
-- Aman: tabel baru, tidak mengubah tabel yang ada. Kode bot tetap jalan bila
-- migrasi ini belum diterapkan (penyimpanan draft best-effort).

CREATE TABLE IF NOT EXISTS public.booking_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  phone           text NOT NULL,
  guest_name      text,
  check_in        date,
  check_out       date,
  room_type       text,
  quoted_total    bigint,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'completed', 'failed', 'cancelled')),
  booking_code    text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_drafts_status_created
  ON public.booking_drafts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_drafts_phone
  ON public.booking_drafts (phone, created_at DESC);

ALTER TABLE public.booking_drafts ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.booking_drafts TO service_role;

-- Staf boleh membaca draft (untuk melanjutkan booking yang gagal); penulisan hanya service_role (bot).
CREATE POLICY "Staff read booking_drafts"
  ON public.booking_drafts
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));
