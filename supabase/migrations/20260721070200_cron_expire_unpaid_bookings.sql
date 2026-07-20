-- ============================================================
-- Payment deadline: auto-expire booking pending+unpaid setelah 1 jam
-- ============================================================
--
-- Jadwalkan cron 'expire-unpaid-bookings' setiap 1 menit dengan dynamic
-- domain lookup (pola sama dengan booking-stuck-monitor / drain-wa-queue).
-- Route /api/cron/expire-bookings yang melakukan pekerjaan sesungguhnya:
-- cari bookings status='pending' AND payment_status='unpaid' AND
-- expires_at < now(), lalu set status='expired'. Booking partial/paid tidak
-- pernah tersentuh karena filter payment_status='unpaid'.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-unpaid-bookings') THEN
    PERFORM cron.unschedule('expire-unpaid-bookings');
  END IF;

  PERFORM cron.schedule(
    'expire-unpaid-bookings',
    '* * * * *', -- setiap menit
    $cron$
      SELECT net.http_post(
        url     := COALESCE(
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
                   ) || '/api/cron/expire-bookings',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );
END;
$migration$;

-- Inspeksi / tuning:
--   SELECT * FROM cron.job WHERE jobname = 'expire-unpaid-bookings';
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT cron.unschedule('expire-unpaid-bookings');   -- untuk menonaktifkan
