-- Automatically delete City Guide events that have already passed.
--
-- Owner preference:
-- Past events should be removed from the database, not just hidden with
-- status='expired'. This keeps Admin City Guide and /explore clean.
--
-- Rule:
-- Delete rows from seo_generated_articles where:
--   category = 'event'
--   status is active/expired
--   event_end_date < today in Asia/Jakarta (WIB)
-- Archived rows are kept as historical/manual archives.

CREATE OR REPLACE FUNCTION public.delete_past_city_guide_events()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER := 0;
  today_wib DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  DELETE FROM public.seo_generated_articles
  WHERE category = 'event'
    AND status IN ('active', 'expired')
    AND event_end_date IS NOT NULL
    AND event_end_date < today_wib;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_past_city_guide_events() TO authenticated, service_role;

-- Run once immediately when migration is applied.
SELECT public.delete_past_city_guide_events();

-- Schedule daily cleanup at 00:10 WIB if pg_cron is available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delete-past-city-guide-events') THEN
    PERFORM cron.unschedule('delete-past-city-guide-events');
  END IF;

  PERFORM cron.schedule(
    'delete-past-city-guide-events',
    '10 0 * * *',
    'SELECT public.delete_past_city_guide_events();'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable, cleanup still runs via app cron: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
