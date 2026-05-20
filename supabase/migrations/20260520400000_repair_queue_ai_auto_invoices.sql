-- ============================================================
-- Repair: re-apply migrations 20260520100000, 200000, 300000
--
-- Those migrations failed because of a typo in the GRANT block
-- of 20260520100000 ("TO boolean" should be "TO service_role").
-- PostgreSQL rolled back the whole transaction, so none of the
-- objects (wa_conversation_queue, queue functions, ai_auto column,
-- invoices table) were ever created.
--
-- All statements below are idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ─── From 20260520100000: wa_conversation_queue table ────────────────────────

CREATE TABLE IF NOT EXISTS wa_conversation_queue (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text        NOT NULL,
  thread_id         uuid        NOT NULL REFERENCES whatsapp_threads(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','waiting','processing','sent','failed','retrying')),
  first_message_at  timestamptz NOT NULL DEFAULT now(),
  process_after     timestamptz NOT NULL DEFAULT now(),
  max_wait_until    timestamptz NOT NULL DEFAULT (now() + interval '25 seconds'),
  started_at        timestamptz,
  completed_at      timestamptz,
  message_count     integer     NOT NULL DEFAULT 1,
  last_message_body text        NOT NULL DEFAULT '',
  last_message_id   uuid,
  reply_text        text,
  worker_id         text,
  locked_at         timestamptz,
  lock_expires_at   timestamptz,
  heartbeat_at      timestamptz,
  attempt           integer     NOT NULL DEFAULT 0,
  max_attempts      integer     NOT NULL DEFAULT 3,
  next_retry_at     timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_cq_phone_active
  ON wa_conversation_queue (phone, status)
  WHERE status IN ('pending','waiting','processing','retrying');

CREATE INDEX IF NOT EXISTS idx_wa_cq_process_after
  ON wa_conversation_queue (process_after)
  WHERE status IN ('pending','waiting');

CREATE INDEX IF NOT EXISTS idx_wa_cq_lock_expires
  ON wa_conversation_queue (lock_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_wa_cq_retry
  ON wa_conversation_queue (next_retry_at)
  WHERE status = 'retrying';

-- ─── Queue functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION wa_queue_upsert(
  p_phone         text,
  p_thread_id     uuid,
  p_message_id    uuid,
  p_body          text,
  p_delay_ms      integer,
  p_max_wait_ms   integer
)
RETURNS TABLE(
  entry_id     uuid,
  sleep_ms     integer,
  is_new_burst boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id       uuid;
  v_max_wait_until    timestamptz;
  v_new_process_after timestamptz;
  v_sleep_ms          integer;
BEGIN
  SELECT q.id, q.max_wait_until
  INTO   v_existing_id, v_max_wait_until
  FROM   wa_conversation_queue q
  WHERE  q.phone  = p_phone
    AND  q.status IN ('pending', 'waiting')
  ORDER  BY q.created_at DESC
  LIMIT  1
  FOR UPDATE SKIP LOCKED;

  IF v_existing_id IS NOT NULL THEN
    v_new_process_after := LEAST(
      now() + make_interval(secs => p_delay_ms::float / 1000.0),
      v_max_wait_until
    );

    UPDATE wa_conversation_queue
    SET
      status            = 'waiting',
      process_after     = v_new_process_after,
      last_message_body = p_body,
      last_message_id   = p_message_id,
      message_count     = message_count + 1,
      updated_at        = now()
    WHERE id = v_existing_id;

    v_sleep_ms := GREATEST(0,
      EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000
    )::integer;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;
  ELSE
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until    := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);

    INSERT INTO wa_conversation_queue (
      phone, thread_id, last_message_id, last_message_body,
      process_after, max_wait_until, status, message_count
    ) VALUES (
      p_phone, p_thread_id, p_message_id, p_body,
      v_new_process_after, v_max_wait_until, 'pending', 1
    )
    RETURNING id INTO v_existing_id;

    v_sleep_ms := p_delay_ms;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION wa_queue_claim(
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
      lock_expires_at = now() + interval '28 seconds',
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

CREATE OR REPLACE FUNCTION wa_queue_claim_retry(
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
      lock_expires_at = now() + interval '28 seconds',
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

CREATE OR REPLACE FUNCTION wa_queue_heartbeat(
  p_entry_id  uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE wa_conversation_queue
  SET
    heartbeat_at    = now(),
    lock_expires_at = now() + interval '28 seconds',
    updated_at      = now()
  WHERE id        = p_entry_id
    AND worker_id = p_worker_id
    AND status    = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION wa_queue_complete(
  p_entry_id  uuid,
  p_worker_id text,
  p_reply     text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE wa_conversation_queue
  SET
    status       = 'sent',
    reply_text   = p_reply,
    completed_at = now(),
    updated_at   = now()
  WHERE id        = p_entry_id
    AND worker_id = p_worker_id
    AND status    = 'processing';
$$;

CREATE OR REPLACE FUNCTION wa_queue_fail(
  p_entry_id  uuid,
  p_worker_id text,
  p_error     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt      integer;
  v_max_attempts integer;
  v_new_status   text;
  v_backoff_secs float;
BEGIN
  SELECT attempt, max_attempts
  INTO   v_attempt, v_max_attempts
  FROM   wa_conversation_queue
  WHERE  id        = p_entry_id
    AND  worker_id = p_worker_id
    AND  status    = 'processing';

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_attempt < v_max_attempts THEN
    v_backoff_secs := POWER(2.0, v_attempt::float);
    v_new_status   := 'retrying';

    UPDATE wa_conversation_queue
    SET
      status        = 'retrying',
      last_error    = p_error,
      next_retry_at = now() + make_interval(secs => v_backoff_secs),
      updated_at    = now()
    WHERE id = p_entry_id;
  ELSE
    v_new_status := 'failed';

    UPDATE wa_conversation_queue
    SET
      status       = 'failed',
      last_error   = p_error,
      completed_at = now(),
      updated_at   = now()
    WHERE id = p_entry_id;
  END IF;

  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION wa_queue_cleanup_zombies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH cleaned AS (
    UPDATE wa_conversation_queue
    SET
      status       = 'failed',
      last_error   = 'zombie_timeout: worker lock expired without completing',
      completed_at = now(),
      updated_at   = now()
    WHERE status          = 'processing'
      AND lock_expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cleaned;

  WITH stale AS (
    UPDATE wa_conversation_queue
    SET
      status       = 'failed',
      last_error   = 'max_wait_exceeded: no worker completed within max_wait_until',
      completed_at = now(),
      updated_at   = now()
    WHERE status         IN ('pending', 'waiting')
      AND max_wait_until  < now() - interval '5 seconds'
    RETURNING id
  )
  SELECT v_count + COUNT(*) INTO v_count FROM stale;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION wa_queue_get_retrying(p_phone text)
RETURNS TABLE(entry_id uuid, attempt integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id, attempt
  FROM   wa_conversation_queue
  WHERE  phone         = p_phone
    AND  status        = 'retrying'
    AND  next_retry_at <= now()
  ORDER  BY next_retry_at ASC
  LIMIT  1;
$$;

DROP VIEW IF EXISTS wa_queue_stats;
CREATE VIEW wa_queue_stats AS
SELECT
  date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta') AS hour_wib,
  COUNT(*)                                                    AS total_bursts,
  COUNT(*) FILTER (WHERE status = 'sent')                    AS sent,
  COUNT(*) FILTER (WHERE status = 'failed')                  AS failed,
  COUNT(*) FILTER (WHERE status = 'retrying')                AS retrying,
  COUNT(*) FILTER (WHERE status = 'processing')              AS processing,
  COUNT(*) FILTER (WHERE status IN ('pending','waiting'))    AS queued,
  ROUND(AVG(message_count) FILTER (WHERE status = 'sent'), 1)::numeric AS avg_msgs_per_burst,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (completed_at - first_message_at)) * 1000
  ) FILTER (WHERE status = 'sent'))::int                     AS avg_total_response_ms,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (started_at - first_message_at)) * 1000
  ) FILTER (WHERE status = 'sent'))::int                     AS avg_delay_ms
FROM wa_conversation_queue
WHERE created_at >= (now() AT TIME ZONE 'Asia/Jakarta')::date AT TIME ZONE 'Asia/Jakarta'
GROUP BY 1
ORDER BY 1 DESC;

-- Grants
GRANT ALL     ON TABLE   wa_conversation_queue                          TO anon;
GRANT ALL     ON TABLE   wa_conversation_queue                          TO service_role;
GRANT SELECT  ON         wa_queue_stats                                 TO service_role;
GRANT EXECUTE ON FUNCTION wa_queue_upsert(text,uuid,uuid,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_claim(uuid,text)                     TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_claim_retry(uuid,text)               TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_heartbeat(uuid,text)                 TO service_role;
GRANT EXECUTE ON FUNCTION wa_queue_heartbeat(uuid,text)                 TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_complete(uuid,text,text)             TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_fail(uuid,text,text)                 TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_cleanup_zombies()                    TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_get_retrying(text)                   TO anon;

-- ─── From 20260520200000: per-thread ai_auto toggle ──────────────────────────

ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS ai_auto boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_thread_id       uuid;
  v_ai_auto         boolean := true;
  v_auto_reply      boolean := false;
  v_fonnte_token    text    := '';
  v_ai_lab_config   jsonb   := '{}';
  v_smart_delay_cfg jsonb   := NULL;
  v_messages        jsonb   := '[]';
BEGIN
  SELECT id, ai_auto
  INTO   v_thread_id, v_ai_auto
  FROM   whatsapp_threads
  WHERE  phone = p_phone
  LIMIT  1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(fonnte_token, ''),
    COALESCE(ai_lab_config, '{}'),
    smart_delay_config
  INTO v_fonnte_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
  LIMIT 1;

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  ) AND v_ai_auto;

  SELECT jsonb_agg(
           jsonb_build_object(
             'direction', direction,
             'body',      body
           ) ORDER BY sent_at ASC
         )
  INTO v_messages
  FROM (
    SELECT direction, body, sent_at
    FROM   whatsapp_messages
    WHERE  thread_id = v_thread_id
    ORDER  BY sent_at DESC
    LIMIT  30
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',          v_thread_id,
    'auto_reply_enabled', v_auto_reply,
    'fonnte_token',       v_fonnte_token,
    'messages',           COALESCE(v_messages, '[]'::jsonb),
    'smart_delay_config', v_smart_delay_cfg
  );
END;
$$;

-- ─── From 20260520300000: invoices table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoices (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             UUID        NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  invoice_number         TEXT        NOT NULL,
  pdf_url                TEXT,
  payment_status_snapshot TEXT,
  wa_sent_at             TIMESTAMPTZ,
  issued_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'invoices'
      AND policyname = 'staff manage invoices'
  ) THEN
    CREATE POLICY "staff manage invoices" ON public.invoices FOR ALL TO authenticated
      USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_invoices_booking ON public.invoices(booking_id);

NOTIFY pgrst, 'reload schema';
