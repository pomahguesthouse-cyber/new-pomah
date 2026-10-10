-- Jaring pengaman invoice WhatsApp yang terputus di Cloudflare Workers.
--
-- Booking admin/website dulu memanggil generateAndSendInvoiceNotification
-- dengan `void`. Worker memutus pekerjaan itu setelah response, sehingga
-- baris `invoices` tidak pernah tertulis. Cron ini mengirim invoice untuk
-- booking non-batal berusia 5 menit–24 jam yang punya nomor tamu dan belum
-- punya baris invoices. Klaim wa_sent_at di service menolak kirim kedua.
--
-- HARUS DIJALANKAN MANUAL setelah deploy bila pipeline migrasi tidak
-- menerapkan file ini sendiri:
--   supabase/migrations/20261010140000_cron_recover_missing_invoices.sql

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-missing-invoices') THEN
    PERFORM cron.unschedule('recover-missing-invoices');
  END IF;

  PERFORM cron.schedule(
    'recover-missing-invoices',
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
                                ) || '/api/cron/recover-missing-invoices',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END;
$migration$;

-- Inspeksi:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'recover-missing-invoices';
--   SELECT cron.unschedule('recover-missing-invoices');
