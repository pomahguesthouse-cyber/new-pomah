-- Migration: Schedule Proactive Review Requests (Fixed Syntax)
-- Description: Menggunakan pg_cron untuk memicu Edge Function send-review-request 
-- setiap hari pada jam 15:00 WIB (08:00 UTC).

-- 1. Pastikan ekstensi pg_cron tersedia
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Hapus jadwal lama jika ada (menggunakan SELECT agar kompatibel dengan SQL Editor)
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'proactive-google-review-request';

-- 3. Jadwalkan ulang permintaan ulasan pada jam 15:00 WIB (08:00 UTC)
SELECT cron.schedule(
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

NOTIFY pgrst, 'reload schema';
