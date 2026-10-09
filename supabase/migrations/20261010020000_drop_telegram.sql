-- Drop the Telegram AI chat feature.
-- Apply manually AFTER the app deploy that removes /api/telegram,
-- /api/telegram/$agentKey, and Admin → Telegram.
-- Idempotent. Does not touch bookings, prices, WhatsApp history,
-- notification_logs, or staff push.
--
-- KEPT:
--   public.notification_logs.channel
--     (WhatsApp and push still write this column; default stays 'wa')
--   public.conversation_alerts
--     (dashboard alerts stay; only telegram_message_id is removed)
--   public.whatsapp_threads / public.whatsapp_messages

-- 1) Unschedule any cron job whose name or command still mentions telegram.
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
    WHERE jobname ILIKE '%telegram%'
       OR command ILIKE '%telegram%'
  LOOP
    PERFORM cron.unschedule(job.jobid);
    RAISE NOTICE 'unscheduled cron job % (%)', job.jobname, job.jobid;
  END LOOP;
END $$;

-- 2) Manager link-token guard, then any other public function named *telegram*.
DROP TRIGGER IF EXISTS guard_property_managers_telegram_link_token
  ON public.property_managers;
DROP FUNCTION IF EXISTS public.guard_property_managers_telegram_link_token();

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
      AND p.proname ILIKE '%telegram%'
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

-- 3) Chat tables. CASCADE drops their policies, indexes, and triggers.
DROP TABLE IF EXISTS public.telegram_agent_conversations CASCADE;
DROP TABLE IF EXISTS public.telegram_agent_bots CASCADE;
DROP TABLE IF EXISTS public.telegram_agent_channels CASCADE;
DROP TABLE IF EXISTS public.telegram_chat_history CASCADE;

-- 4) properties.telegram_* (bot token, username, webhook secret, and any other).
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name ILIKE 'telegram\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE public.properties DROP COLUMN IF EXISTS %I', col.column_name);
    RAISE NOTICE 'dropped properties.%', col.column_name;
  END LOOP;
END $$;

-- 5) property_managers.telegram_* including telegram_chat_id and the link columns.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'property_managers'
      AND column_name ILIKE 'telegram\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.property_managers DROP COLUMN IF EXISTS %I',
      col.column_name
    );
    RAISE NOTICE 'dropped property_managers.%', col.column_name;
  END LOOP;
END $$;

-- 6) Alert row no longer stores a Telegram message id to edit.
DO $$
BEGIN
  IF to_regclass('public.conversation_alerts') IS NOT NULL THEN
    ALTER TABLE public.conversation_alerts
      DROP COLUMN IF EXISTS telegram_message_id;
  END IF;
END $$;
