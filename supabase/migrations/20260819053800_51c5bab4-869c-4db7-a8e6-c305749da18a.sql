select cron.schedule(
  'evolution-inbox-poll',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://pomahguesthouse.com/api/cron/evolution-inbox-poll',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $$
);