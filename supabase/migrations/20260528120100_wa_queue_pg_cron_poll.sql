-- ============================================================
-- Phase 2 — Reliable idle-batching driver via pg_cron
-- ============================================================
--
-- The webhook now only enqueues (wa_queue_upsert) and returns 200 — it never
-- waits for the debounce window. The window lives in process_after, so SOMETHING
-- must poll the queue and drain entries once they become ready. pg_cron does
-- that here: every few seconds it POSTs /api/cron/process-wa-queue, which runs
-- wa_queue_cleanup_zombies + drainQueue (atomic FOR UPDATE SKIP LOCKED claim).
--
-- This is the multi-instance-safe replacement for the in-request waitUntil
-- debounce. The AFTER INSERT pg_net trigger (t_process_wa_queue) still fires on
-- the first message of a burst for low latency on already-ready entries; this
-- cron catches the idle completion of bursts that received no further trigger.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  -- Recreate idempotently.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-wa-queue') THEN
    PERFORM cron.unschedule('drain-wa-queue');
  END IF;

  -- Every 2 seconds: worst-case reply latency ≈ idle window (2-4s) + ~2s poll.
  PERFORM cron.schedule(
    'drain-wa-queue',
    '2 seconds',
    $cron$
      SELECT net.http_post(
        url     := 'https://pomahguesthouse.com/api/cron/process-wa-queue',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );
END $$;

-- To inspect / tune later:
--   SELECT * FROM cron.job WHERE jobname = 'drain-wa-queue';
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT cron.unschedule('drain-wa-queue');   -- to disable
