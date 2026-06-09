-- 1) Perluas CHECK constraint event_type di notification_logs untuk mengizinkan 'booking_stuck'.
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_event_type_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'new_booking'::text,
    'payment_proof'::text,
    'complaint'::text,
    'new_session'::text,
    'bot_loop'::text,
    'zombie_timeout'::text,
    'booking_stuck'::text
  ]));

-- 2) Pastikan ekstensi pg_cron & pg_net aktif (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3) Jadwalkan booking-stuck monitor setiap 1 menit dengan dynamic domain lookup
--    (pola sama dengan drain-wa-queue / run-article-schedules).
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'booking-stuck-monitor') THEN
    PERFORM cron.unschedule('booking-stuck-monitor');
  END IF;

  PERFORM cron.schedule(
    'booking-stuck-monitor',
    '* * * * *', -- every minute
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
                   ) || '/api/cron/booking-stuck-monitor',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );
END;
$migration$;