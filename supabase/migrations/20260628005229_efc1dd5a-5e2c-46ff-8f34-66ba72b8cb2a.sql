
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-article-schedules') THEN
    PERFORM cron.unschedule('run-article-schedules');
  END IF;

  PERFORM cron.schedule(
    'run-article-schedules',
    '*/5 * * * *',
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
                   ) || '/api/cron/run-article-schedules',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cron$
  );
END $migration$;
