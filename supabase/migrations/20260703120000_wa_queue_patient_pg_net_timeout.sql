-- ============================================================
-- Penggerak antrian "sabar" — override timeout pg_net 5s → 20s
-- ============================================================
--
-- Latar (insiden 3 Juli 2026, tamu diam ~6 menit): pg_net men-drop request
-- setelah TIMEOUT DEFAULT 5 DETIK, sedangkan runtime hosting tidak menyuplai
-- `waitUntil` sehingga drain berjalan SINKRON di dalam request (verifikasi:
-- endpoint membalas HTTP 200, bukan 202). Akibatnya setiap pesan yang butuh
-- >5s pemrosesan AI dibunuh di tengah oleh kliennya sendiri → entry zombie →
-- tertahan lock TTL 40s → diklaim ulang → dibunuh lagi. ~9 siklus × 40s ≈
-- 6 menit bisu — persis pola insiden.
--
-- Perbaikan: jadikan pg_cron klien yang SABAR. Anggaran AI kini 14s/attempt
-- × 1 attempt (wa-autoreply.service.ts) + RAG/tool ± margin → 20.000 ms cukup
-- untuk menunggu satu drain tuntas end-to-end tanpa memutus koneksi.
--
-- Kadens tetap 2 detik. pg_net async (antre di net.http_request_queue), jadi
-- request yang tumpang tindih aman: drainQueue memakai FOR UPDATE SKIP LOCKED
-- + guard per-phone, invocation paralel tidak saling injak.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  -- Recreate idempotently.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-wa-queue') THEN
    PERFORM cron.unschedule('drain-wa-queue');
  END IF;

  PERFORM cron.schedule(
    'drain-wa-queue',
    '2 seconds',
    $cron$
      SELECT net.http_post(
        url                  := 'https://pomahguesthouse.com/api/cron/process-wa-queue',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 20000
      );
    $cron$
  );
END $$;

-- Trigger AFTER INSERT (jalur latensi-rendah pesan pertama) diberi timeout
-- sabar yang sama — sebelumnya juga terpotong di default 5s.
CREATE OR REPLACE FUNCTION public.trigger_process_wa_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://pomahguesthouse.com/api/queue-worker',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', row_to_json(NEW)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );

  RETURN NEW;
END;
$$;

-- Verifikasi setelah apply:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'drain-wa-queue';
--   SELECT status, timed_out, error_msg FROM net._http_response ORDER BY created DESC LIMIT 20;
--   SELECT status, count(*) FROM wa_conversation_queue GROUP BY status;
