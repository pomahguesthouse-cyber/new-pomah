-- Migration: Schedule Proactive Review Requests
-- Description: Uses pg_cron to trigger the send-review-request Edge Function 
-- every day at 13:00 WIB (after standard 12:00 checkout).

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- 1. Unschedule if already exists to avoid duplicates
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proactive-google-review-request') THEN
    PERFORM cron.unschedule('proactive-google-review-request');
  END IF;

  -- 2. Schedule the request
  -- 06:00 UTC is 13:00 WIB (Asia/Jakarta)
  -- Note: Replace <YOUR_PROJECT_REF> with your actual Supabase project reference if not using local relative calls
  -- For Edge Functions, we usually use net.http_post
  PERFORM cron.schedule(
    'proactive-google-review-request',
    '0 6 * * *',
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
