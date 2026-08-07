-- P1 (audit 7 Agu 2026): pisahkan pekerjaan safety-net dari drain 2 detik.
--
-- `drain-wa-queue` tetap jalan tiap 2 detik (latency balasan tamu bergantung
-- padanya), tetapi handler-nya sekarang keluar lebih awal bila antrian kosong.
-- Recovery pesan yang tidak ter-enqueue + pengiriman fallback untuk entry yang
-- gagal dipindah ke job terpisah dengan cadence 1 menit — keduanya jaring
-- pengaman, bukan hot path, dan pada cadence 2 detik menghabiskan ratusan
-- query per menit tanpa hasil.

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-queue-safety-net') THEN
    PERFORM cron.unschedule('wa-queue-safety-net');
  END IF;

  PERFORM cron.schedule(
    'wa-queue-safety-net',
    '* * * * *',  -- tiap menit
    $cron$
      SELECT net.http_post(
        url                  := 'https://pomahguesthouse.com/api/cron/wa-queue-safety-net',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END $$;

-- Verifikasi manual:
--   SELECT jobname, schedule FROM cron.job
--   WHERE jobname IN ('drain-wa-queue', 'wa-queue-safety-net');
