-- Drop the retired self-hosted WhatsApp gateway.
-- Apply manually AFTER the app deploy that removes those routes.
-- Idempotent. Does not drop guest chat history.
--
-- KEPT (Meta inbox still reads these):
--   public.whatsapp_threads
--   public.whatsapp_messages
--   public.whatsapp_meta_outbound
--   public.whatsapp_webhook_events
--   public.properties.wpp_token
--     (still read by get_autoreply_context and internal route auth;
--      clear the value only after INTERNAL_ROUTE_SECRET or CRON_SECRET
--      is confirmed — do not drop the column here)

-- 1) Unschedule any cron job whose name or command still targets the old gateway.
DO $$
DECLARE
  job record;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron schema absent; skip unschedule';
    RETURN;
  END IF;

  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname ILIKE '%evolution%'
       OR command ILIKE '%evolution%'
  LOOP
    PERFORM cron.unschedule(job.jobid);
    RAISE NOTICE 'unscheduled cron job % (%)', job.jobname, job.jobid;
  END LOOP;
END $$;

-- 2) Operational sync cursor only. Guest transcripts live in whatsapp_messages.
DROP TRIGGER IF EXISTS trg_touch_wa_wpp_sync_state ON public.wa_wpp_sync_state;
DROP FUNCTION IF EXISTS public.touch_wa_wpp_sync_state_updated_at();
DROP FUNCTION IF EXISTS public.mark_wpp_thread_synced(uuid, text, text, text);
DROP TABLE IF EXISTS public.wa_wpp_sync_state;

-- 3) Functions whose names belong to the retired gateway, if any remain.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname ILIKE '%evolution%'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s)',
      fn.schema_name,
      fn.function_name,
      fn.args
    );
    RAISE NOTICE 'dropped function %.%(%)', fn.schema_name, fn.function_name, fn.args;
  END LOOP;
END $$;

-- 4) Status rows for retired gateways. Keep channel = 'whatsapp_meta'.
DELETE FROM public.channel_status
WHERE channel ILIKE '%evolution%'
   OR channel IN ('whatsapp_wpp', 'whatsapp_fonnte');

-- 5) One provider. Existing threads stay; only the label changes so the
--    24-hour Meta window applies. Messages are not deleted.
ALTER TABLE public.whatsapp_threads
  ALTER COLUMN provider SET DEFAULT 'meta';

UPDATE public.whatsapp_threads
SET provider = 'meta'
WHERE provider IS DISTINCT FROM 'meta';
