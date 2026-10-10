-- Jaring pengaman alert WhatsApp booking baru ke staf.
--
-- notifyNewBooking dulu berjalan di waitUntil / runDeferred. Worker memutus
-- pekerjaan itu setelah response: tidak ada baris notification_logs, atau
-- baris pending dengan 0 attempt. Meta juga menolak teks bebas di luar
-- jendela 24 jam (131047) secara asinkron, sementara log sempat tercatat sent.
--
-- Cron ini memanggil /api/cron/recover-staff-booking-alerts tiap menit.
-- Service hanya mengirim ke pengelola aktif yang belum punya log
-- sent/delivered/read untuk booking non-batal berusia 2 menit–24 jam,
-- dan mengulang pending 0 attempt. Dedupe new_booking:<booking>:<manager>
-- menolak kirim kedua yang sudah diterima Meta.
--
-- Kolom provider_message_id menyimpan wamid. Webhook status mencocokkannya
-- untuk mengubah log menjadi delivered / read / failed.
--
-- HARUS DIJALANKAN MANUAL setelah deploy bila pipeline migrasi tidak
-- menerapkan file ini sendiri:
--   supabase/migrations/20261010160000_cron_recover_staff_booking_alerts.sql

ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS notification_logs_provider_message_id_idx
  ON public.notification_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

DO $drop_status$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'notification_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$drop_status$;

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text]));

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-staff-booking-alerts') THEN
    PERFORM cron.unschedule('recover-staff-booking-alerts');
  END IF;

  PERFORM cron.schedule(
    'recover-staff-booking-alerts',
    '* * * * *', -- setiap menit
    $cron$
      SELECT net.http_post(
        url                  := COALESCE(
                                  (
                                    SELECT
                                      CASE
                                        WHEN public_domain IS NULL OR trim(public_domain) = '' THEN 'https://pomahguesthouse.com'
                                        WHEN public_domain LIKE 'http%' THEN rtrim(public_domain, '/')
                                        ELSE 'https://' || rtrim(public_domain, '/')
                                      END
                                    FROM public.properties
                                    LIMIT 1
                                  ),
                                  'https://pomahguesthouse.com'
                                ) || '/api/cron/recover-staff-booking-alerts',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END;
$migration$;

-- Inspeksi:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'recover-staff-booking-alerts';
--   SELECT cron.unschedule('recover-staff-booking-alerts');
