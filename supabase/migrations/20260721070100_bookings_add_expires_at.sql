-- Batas waktu pembayaran: kolom expires_at diisi aplikasi saat booking dibuat
-- (created_at + 1 jam), untuk SEMUA channel (web, chatbot WA, webchat, admin).
-- Nullable & tanpa backfill — booking lama sebelum fitur ini tetap NULL dan
-- tidak pernah cocok dengan filter cron `expires_at < now()`.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Index parsial untuk query cron (status pending + unpaid + expires_at lewat).
CREATE INDEX IF NOT EXISTS idx_bookings_expiry ON public.bookings (expires_at)
  WHERE status = 'pending' AND payment_status = 'unpaid';
