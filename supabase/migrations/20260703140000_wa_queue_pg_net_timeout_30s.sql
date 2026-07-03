-- Naikkan timeout pg_net 20s → 30s untuk drain-wa-queue & trigger INSERT.
--
-- Latar: anggaran AI dinaikkan 14s → 18s (wa-autoreply.service.ts, 3 Jul 2026)
-- karena classifier LLM fallback (~5s) + 2 ronde LLM tidak muat di 14s.
-- Rantai lengkap drain sinkron (recovery + klaim + AI 18s + Fonnte + complete)
-- kini bisa ~22-24s — timeout klien 20s terlalu mepet. 30s selaras dengan
-- timeout cron-job.org dan tetap di bawah wall-time Worker.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
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
        timeout_milliseconds := 30000
      );
    $cron$
  );
END $$;

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
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$$;
