-- Drop the retired website chat.
--
-- App code no longer reads or writes these objects. Repo search found no
-- views, functions, cron jobs, or foreign keys from WhatsApp, bookings,
-- notifications, or AI tools that depend on them.
--
-- webchat_threads points at bookings, whatsapp_threads, and properties.
-- Those parent tables are not dropped. CASCADE is not used: the child
-- table is dropped first, so an unexpected outside dependency fails the
-- migration instead of being removed.
--
-- Every statement is idempotent. Missing objects are skipped.

-- 1) Leave the realtime publication if a live database added these tables.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'webchat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.webchat_messages;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'webchat_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.webchat_threads;
  END IF;
END $$;

-- 2) Indexes created by the web chat migrations.
DROP INDEX IF EXISTS public.webchat_messages_thread_time_idx;
DROP INDEX IF EXISTS public.idx_webchat_messages_property_id;
DROP INDEX IF EXISTS public.webchat_threads_last_msg_idx;
DROP INDEX IF EXISTS public.webchat_threads_status_idx;
DROP INDEX IF EXISTS public.webchat_threads_phone_idx;
DROP INDEX IF EXISTS public.idx_webchat_threads_property_id;

-- 3) Policies and triggers. DROP POLICY / DROP TRIGGER require the table.
DO $$
BEGIN
  IF to_regclass('public.webchat_messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS "staff manage webchat messages" ON public.webchat_messages;
    DROP TRIGGER IF EXISTS webchat_messages_updated_at ON public.webchat_messages;
  END IF;

  IF to_regclass('public.webchat_threads') IS NOT NULL THEN
    DROP POLICY IF EXISTS "staff manage webchat threads" ON public.webchat_threads;
    DROP TRIGGER IF EXISTS webchat_threads_updated_at ON public.webchat_threads;
  END IF;
END $$;

-- 4) Messages first (they reference threads). No CASCADE.
DROP TABLE IF EXISTS public.webchat_messages;
DROP TABLE IF EXISTS public.webchat_threads;

-- 5) log_webchat_message overloads. The 3-arg form was replaced by the
--    4-arg form; drop both, then any other signature that still exists.
DROP FUNCTION IF EXISTS public.log_webchat_message(uuid, text, text);
DROP FUNCTION IF EXISTS public.log_webchat_message(uuid, text, text, jsonb);

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
      AND p.proname = 'log_webchat_message'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s)',
      fn.schema_name,
      fn.function_name,
      fn.args
    );
  END LOOP;
END $$;

-- 6) One status row. The channel_status table stays for WhatsApp Meta.
DO $$
BEGIN
  IF to_regclass('public.channel_status') IS NOT NULL THEN
    DELETE FROM public.channel_status WHERE channel = 'webchat';
  END IF;
END $$;

-- 7) Cron jobs that exist only for web chat. None are defined in this
--    repo; this catches a job created outside the migrations.
DO $$
DECLARE
  job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname ILIKE '%webchat%'
         OR command ILIKE '%webchat_threads%'
         OR command ILIKE '%webchat_messages%'
         OR command ILIKE '%log_webchat_message%'
         OR command ILIKE '%webchat-attachments%'
    LOOP
      PERFORM cron.unschedule(job.jobid);
    END LOOP;
  END IF;
END $$;

-- 8) Views or enum types named for web chat. None exist in this repo.
DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT n.nspname AS schema_name, c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname = 'public'
      AND c.relname ILIKE '%webchat%'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I', obj.schema_name, obj.view_name);
  END LOOP;

  FOR obj IN
    SELECT n.nspname AS schema_name, t.typname AS type_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e'
      AND n.nspname = 'public'
      AND t.typname ILIKE '%webchat%'
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %I.%I', obj.schema_name, obj.type_name);
  END LOOP;
END $$;

-- 9) Attachment bucket. Not created by a migration in this repo; drop it
--    only when present. Files go first, then policies, then the bucket.
DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'webchat-attachments';

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND (
          policyname ILIKE '%webchat%'
          OR COALESCE(qual, '') ILIKE '%webchat-attachments%'
          OR COALESCE(with_check, '') ILIKE '%webchat-attachments%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
    END LOOP;
  END IF;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets
    WHERE id = 'webchat-attachments'
       OR name = 'webchat-attachments';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
