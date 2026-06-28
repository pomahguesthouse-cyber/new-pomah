-- Disable the unused SEO article generator cron; it wasted ~2500 Gemini tokens
-- every 5 minutes and is intentionally kept off.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-article-schedules') THEN
    PERFORM cron.unschedule('run-article-schedules');
    RAISE NOTICE 'Unscheduled run-article-schedules cron';
  END IF;
END $$;
