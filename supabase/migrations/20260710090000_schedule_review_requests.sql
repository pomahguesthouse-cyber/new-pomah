-- Migration: Schedule Proactive Review Requests
-- Description: Menggunakan pg_cron untuk memicu Edge Function send-review-request 
-- setiap hari pada jam 15:00 WIB (setelah waktu check-out standar jam 12:00).

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- 1. Unschedule if already exists to avoid duplicates
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proactive-google-review-request') THEN
    PERFORM cron.unschedule('proactive-google-review-request');
  END IF;

  -- 2. Schedule the request
  -- 2. Jadwalkan permintaan ulasan
  -- 08:00 UTC sama dengan 15:00 WIB (Asia/Jakarta)
  -- Menggunakan pg_net (net.http_post) untuk memanggil Edge Function secara internal
  PERFORM cron.schedule(
    'proactive-google-review-request',
    '0 8 * * *',
    $$
    SELECT
      net.http_post(
        url:='https://gofvxeiulaljwyfyhnww.supabase.co/functions/v1/send-review-request',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb,
        body:='{}'::jsonb
      );
    $$
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron or pg_net unavailable, automatic scheduling skipped: %', SQLERRM;
END $$;
