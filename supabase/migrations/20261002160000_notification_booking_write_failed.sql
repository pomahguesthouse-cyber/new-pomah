-- Izinkan event notifikasi staf saat booking bot gagal tercatat.
-- Pola sama dengan event_type lain di notification_logs (new_booking, booking_expired, …).
-- Tanpa baris ini, insert log ditolak constraint; push enqueue_staff_push tetap dicoba.

ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_event_type_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_event_type_check CHECK (event_type = ANY (ARRAY['new_booking'::text,'payment_proof'::text,'complaint'::text,'new_session'::text,'new_message'::text,'bot_loop'::text,'zombie_timeout'::text,'booking_stuck'::text,'rpc_failure'::text,'booking_expired'::text,'booking_updated'::text,'ai_credit_low'::text,'booking_write_failed'::text]));
