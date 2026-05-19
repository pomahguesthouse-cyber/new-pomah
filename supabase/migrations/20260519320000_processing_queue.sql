-- ============================================================
-- WhatsApp AI Processing Queue
-- ============================================================
-- Decouples the lightweight webhook handler from the heavy AI
-- pipeline.  When the webhook saves an inbound message it inserts
-- a row here; a pg_net trigger fires the Edge Function in the
-- background so the webhook can return 200 immediately.
--
-- Flow:
--   INSERT wa_processing_queue
--     → AFTER INSERT trigger
--     → net.http_post → Edge Function process-wa-queue
--     → AI pipeline → Fonnte send → mark done
-- ============================================================

-- ─── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_processing_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text        NOT NULL,
  message_id   uuid        REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  body         text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','processing','done','failed','skipped')),
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_processing_queue_phone_status
  ON wa_processing_queue (phone, status, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_processing_queue_status_created
  ON wa_processing_queue (status, created_at);

-- ─── 2. enqueue_processing_job RPC ────────────────────────────────────────────
-- Called by the webhook handler.  Supersedes any existing pending job for the
-- same phone number before inserting (prevents stale jobs running after a rapid
-- burst of messages all trigger the Edge Function).

CREATE OR REPLACE FUNCTION enqueue_processing_job(
  p_phone      text,
  p_message_id uuid,
  p_body       text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Supersede any earlier pending jobs for this phone
  UPDATE wa_processing_queue
  SET    status     = 'skipped',
         updated_at = now()
  WHERE  phone  = p_phone
    AND  status = 'pending';

  INSERT INTO wa_processing_queue (phone, message_id, body, status)
  VALUES (p_phone, p_message_id, p_body, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── 3. is_newest_pending_for_phone RPC ───────────────────────────────────────
-- Used by the Edge Function after its smart-delay sleep to confirm it should
-- still proceed (a later message may have been enqueued during the wait).

CREATE OR REPLACE FUNCTION is_newest_pending_for_phone(
  p_queue_id uuid,
  p_phone    text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM   wa_processing_queue
    WHERE  phone      = p_phone
      AND  status     = 'pending'
      AND  created_at > (SELECT created_at FROM wa_processing_queue WHERE id = p_queue_id)
  );
$$;

-- ─── 4. pg_net trigger → Edge Function ────────────────────────────────────────
-- Fires the process-wa-queue Edge Function after every INSERT.
--
-- SETUP REQUIRED (run once after migration):
--
--   ALTER DATABASE postgres
--     SET app.edge_fn_url = 'https://<project_ref>.supabase.co/functions/v1/process-wa-queue';
--
--   ALTER DATABASE postgres
--     SET app.worker_secret = '<random_32_char_secret>';
--
-- Then set the same secret in the Edge Function:
--   supabase secrets set WORKER_SECRET=<same_secret>
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_process_wa_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    text := current_setting('app.edge_fn_url',    true);
  v_secret text := current_setting('app.worker_secret', true);
BEGIN
  -- Skip if the Edge Function URL has not been configured yet
  IF v_url IS NULL OR trim(v_url) = '' THEN
    RAISE WARNING '[wa_queue] app.edge_fn_url not set — Edge Function will not be called';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('queue_id', NEW.id)::text,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-worker-secret', COALESCE(v_secret, '')
    )
  );

  RETURN NEW;
END;
$$;

-- Only create the trigger if pg_net extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    DROP TRIGGER IF EXISTS on_wa_queue_insert ON wa_processing_queue;
    CREATE TRIGGER on_wa_queue_insert
      AFTER INSERT ON wa_processing_queue
      FOR EACH ROW EXECUTE FUNCTION trigger_process_wa_queue();
  ELSE
    RAISE NOTICE '[wa_queue] pg_net not available — trigger not created. '
                 'Enable it in Supabase Dashboard → Database → Extensions.';
  END IF;
END;
$$;

-- ─── 5. Monitoring view ────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW wa_queue_stats AS
SELECT
  date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta') AS hour_wib,
  COUNT(*)                                                     AS total,
  COUNT(*) FILTER (WHERE status = 'done')                      AS done,
  COUNT(*) FILTER (WHERE status = 'failed')                    AS failed,
  COUNT(*) FILTER (WHERE status = 'skipped')                   AS skipped,
  COUNT(*) FILTER (WHERE status = 'pending')                   AS pending,
  COUNT(*) FILTER (WHERE status = 'processing')                AS processing
FROM wa_processing_queue
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- ─── 6. Grants ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION enqueue_processing_job(text, uuid, text)    TO anon;
GRANT EXECUTE ON FUNCTION is_newest_pending_for_phone(uuid, text)     TO anon;
GRANT ALL     ON TABLE   wa_processing_queue                          TO anon;
GRANT SELECT  ON         wa_queue_stats                               TO service_role;
