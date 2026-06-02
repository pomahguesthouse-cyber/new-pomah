-- ============================================================
-- WhatsApp Queue Reliability: Dynamic Webhook Domains & 120s Lock Duration
-- ============================================================

-- 1. Dynamic Webhook Domain for pg_net Queue Trigger
CREATE OR REPLACE FUNCTION public.trigger_process_wa_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text;
BEGIN
  -- Retrieve dynamic public domain from settings
  SELECT public_domain INTO v_domain FROM public.properties LIMIT 1;
  IF v_domain IS NULL OR trim(v_domain) = '' THEN
    v_domain := 'pomahguesthouse.com';
  END IF;
  
  -- Prepend protocol prefix if missing
  IF NOT v_domain LIKE 'http%' THEN
    v_domain := 'https://' || v_domain;
  END IF;
  
  -- Trim trailing slashes
  v_domain := rtrim(v_domain, '/');

  PERFORM net.http_post(
    url := v_domain || '/api/queue-worker',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', row_to_json(NEW)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  
  RETURN NEW;
END;
$$;

-- 2. Extended Worker Lock Expiration (from 28s/30s to 120s to prevent zombie timeouts)
CREATE OR REPLACE FUNCTION public.wa_queue_claim(
  p_entry_id  uuid,
  p_worker_id text
)
RETURNS TABLE(
  claimed           boolean,
  message_count     integer,
  last_message_body text,
  attempt           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  WITH updated AS (
    UPDATE wa_conversation_queue
    SET
      status          = 'processing',
      worker_id       = p_worker_id,
      started_at      = now(),
      locked_at       = now(),
      lock_expires_at = now() + interval '120 seconds',
      heartbeat_at    = now(),
      attempt         = attempt + 1,
      updated_at      = now()
    WHERE id     = p_entry_id
      AND status IN ('pending', 'waiting')
      AND process_after <= now()
    RETURNING *
  )
  SELECT COUNT(*) INTO v_rows_updated FROM updated;

  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT false, 0, ''::text, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, q.message_count, q.last_message_body, q.attempt
  FROM wa_conversation_queue q
  WHERE q.id = p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_queue_claim_retry(
  p_entry_id  uuid,
  p_worker_id text
)
RETURNS TABLE(
  claimed           boolean,
  message_count     integer,
  last_message_body text,
  attempt           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  WITH updated AS (
    UPDATE wa_conversation_queue
    SET
      status          = 'processing',
      worker_id       = p_worker_id,
      started_at      = now(),
      locked_at       = now(),
      lock_expires_at = now() + interval '120 seconds',
      heartbeat_at    = now(),
      attempt         = attempt + 1,
      updated_at      = now()
    WHERE id            = p_entry_id
      AND status        = 'retrying'
      AND next_retry_at <= now()
    RETURNING *
  )
  SELECT COUNT(*) INTO v_rows_updated FROM updated;

  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT false, 0, ''::text, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, q.message_count, q.last_message_body, q.attempt
  FROM wa_conversation_queue q
  WHERE q.id = p_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_queue_heartbeat(
  p_entry_id  uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE wa_conversation_queue
  SET
    heartbeat_at    = now(),
    lock_expires_at = now() + interval '120 seconds',
    updated_at      = now()
  WHERE id        = p_entry_id
    AND worker_id = p_worker_id
    AND status    = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_queue_claim_next(p_worker_id text)
RETURNS TABLE(
  entry_id          uuid,
  phone             text,
  thread_id         uuid,
  message_count     integer,
  last_message_body text,
  attempt           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM   public.wa_conversation_queue q
    WHERE  (q.status IN ('pending', 'waiting') AND q.process_after <= now())
       OR  (q.status = 'retrying'              AND q.next_retry_at <= now())
    ORDER  BY q.process_after ASC
    FOR UPDATE SKIP LOCKED
    LIMIT  1
  ),
  claimed AS (
    UPDATE public.wa_conversation_queue q
    SET
      status          = 'processing',
      worker_id       = p_worker_id,
      started_at      = now(),
      locked_at       = now(),
      lock_expires_at = now() + interval '120 seconds',
      heartbeat_at    = now(),
      attempt         = q.attempt + 1,
      updated_at      = now()
    FROM   picked
    WHERE  q.id = picked.id
    RETURNING q.id, q.phone, q.thread_id, q.message_count, q.last_message_body, q.attempt
  )
  SELECT c.id, c.phone, c.thread_id, c.message_count, c.last_message_body, c.attempt
  FROM   claimed c;
END;
$$;

-- 3. Dynamic Webhook Domain for pg_cron Schedules
-- We use a single outer dollar quoting tag $migration$ to ensure no conflicts with $cron$ literals.
DO $migration$
BEGIN
  -- Unschedule existing jobs to avoid conflicts or duplicates
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-wa-queue') THEN
    PERFORM cron.unschedule('drain-wa-queue');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-article-schedules') THEN
    PERFORM cron.unschedule('run-article-schedules');
  END IF;

  -- Reschedule 'drain-wa-queue' with dynamic domain lookup using SELECT net.http_post
  PERFORM cron.schedule(
    'drain-wa-queue',
    '2 seconds',
    $cron$
      SELECT net.http_post(
        url     := COALESCE(
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
                   ) || '/api/cron/process-wa-queue',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );

  -- Reschedule 'run-article-schedules' with dynamic domain lookup using SELECT net.http_post
  PERFORM cron.schedule(
    'run-article-schedules',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url     := COALESCE(
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
                   ) || '/api/cron/run-article-schedules',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );
END $migration$;
