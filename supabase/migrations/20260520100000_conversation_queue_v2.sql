-- ============================================================
-- Conversation Queue v2 — Production-Grade Smart Delay Engine
-- ============================================================
--
-- Replaces: wa_message_queue + claim_queue_winner + is_still_winner + mark_queue_done
--
-- Key improvements over v1:
--   1. Proper state machine: pending → waiting → processing → sent/failed/retrying
--   2. DB-level atomic locking (FOR UPDATE SKIP LOCKED) prevents double-processing
--   3. MAX_WAIT_TIME: hard deadline so bot ALWAYS replies even if user keeps typing
--   4. Heartbeat mechanism: detect zombie workers, auto-cleanup
--   5. Retry with exponential backoff (up to max_attempts)
--   6. Worker ID tracking: only the claiming worker can complete/fail
--   7. One active row per phone (upsert, not insert)
-- ============================================================

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_conversation_queue (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Conversation identity
  phone             text        NOT NULL,
  thread_id         uuid        NOT NULL REFERENCES whatsapp_threads(id) ON DELETE CASCADE,

  -- ── State machine ──────────────────────────────────────────────────────────
  -- pending    : entry created, delay window has not started timing yet
  -- waiting    : delay countdown active (extended on each new message)
  -- processing : a worker has claimed this entry; AI is running
  -- sent       : reply was sent to WhatsApp successfully
  -- failed     : all retry attempts exhausted
  -- retrying   : waiting for next retry attempt
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','waiting','processing','sent','failed','retrying')),

  -- ── Timing ─────────────────────────────────────────────────────────────────
  first_message_at  timestamptz NOT NULL DEFAULT now(),
  -- When AI processing should begin (extended on each new message in burst)
  process_after     timestamptz NOT NULL DEFAULT now(),
  -- Hard deadline: bot MUST reply by this time no matter how many messages arrive
  max_wait_until    timestamptz NOT NULL DEFAULT (now() + interval '25 seconds'),
  -- When a worker started processing
  started_at        timestamptz,
  -- When the entry was completed (sent or permanently failed)
  completed_at      timestamptz,

  -- ── Message tracking ───────────────────────────────────────────────────────
  -- Total messages received in this burst (for analytics)
  message_count     integer     NOT NULL DEFAULT 1,
  -- Body of the most recent message (used for logging)
  last_message_body text        NOT NULL DEFAULT '',
  last_message_id   uuid,

  -- ── Processing result ──────────────────────────────────────────────────────
  reply_text        text,

  -- ── Worker locking ─────────────────────────────────────────────────────────
  -- UUID generated per request; ensures only the claiming worker can modify
  worker_id         text,
  locked_at         timestamptz,
  -- Worker MUST send heartbeat or complete before this time
  -- If expired: zombie cleanup will reset to 'failed'
  lock_expires_at   timestamptz,
  heartbeat_at      timestamptz,

  -- ── Retry ──────────────────────────────────────────────────────────────────
  attempt           integer     NOT NULL DEFAULT 0,
  max_attempts      integer     NOT NULL DEFAULT 3,
  next_retry_at     timestamptz,
  last_error        text,

  -- ── Audit ──────────────────────────────────────────────────────────────────
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Lookup active entries by phone (used by upsert and claim)
CREATE INDEX IF NOT EXISTS idx_wa_cq_phone_active
  ON wa_conversation_queue (phone, status)
  WHERE status IN ('pending','waiting','processing','retrying');

-- Find entries ready to be processed
CREATE INDEX IF NOT EXISTS idx_wa_cq_process_after
  ON wa_conversation_queue (process_after)
  WHERE status IN ('pending','waiting');

-- Find zombie workers
CREATE INDEX IF NOT EXISTS idx_wa_cq_lock_expires
  ON wa_conversation_queue (lock_expires_at)
  WHERE status = 'processing';

-- Find retrying entries ready for pickup
CREATE INDEX IF NOT EXISTS idx_wa_cq_retry
  ON wa_conversation_queue (next_retry_at)
  WHERE status = 'retrying';

-- ─── Function 1: wa_queue_upsert ─────────────────────────────────────────────
--
-- Called by webhook on EVERY incoming message.
-- Creates a new queue entry, or extends the delay of an existing one.
-- Returns: entry_id, how long this worker should sleep (ms), whether it's a new burst.
--
-- Key guarantee: if a 'pending'/'waiting' entry already exists for this phone,
-- the delay is extended but NEVER beyond max_wait_until. This prevents the
-- "infinite delay reset" problem.

CREATE OR REPLACE FUNCTION wa_queue_upsert(
  p_phone         text,
  p_thread_id     uuid,
  p_message_id    uuid,
  p_body          text,
  p_delay_ms      integer,   -- delay for this message (e.g. 6000 for short messages)
  p_max_wait_ms   integer    -- hard cap from first message (e.g. 25000 = 25s)
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
  -- ── Step 1: Look for an existing active entry (with advisory lock) ──────────
  -- FOR UPDATE SKIP LOCKED ensures concurrent workers don't race on upsert
  SELECT q.id, q.max_wait_until
  INTO   v_existing_id, v_max_wait_until
  FROM   wa_conversation_queue q
  WHERE  q.phone  = p_phone
    AND  q.status IN ('pending', 'waiting')
  ORDER  BY q.created_at DESC
  LIMIT  1
  FOR UPDATE SKIP LOCKED;

  IF v_existing_id IS NOT NULL THEN
    -- ── Extend existing entry, but cap at max_wait_until ─────────────────────
    v_new_process_after := LEAST(
      now() + make_interval(secs => p_delay_ms::float / 1000.0),
      v_max_wait_until
    );

    UPDATE wa_conversation_queue
    SET
      status            = 'waiting',        -- explicitly mark as "actively waiting"
      process_after     = v_new_process_after,
      last_message_body = p_body,
      last_message_id   = p_message_id,
      message_count     = message_count + 1,
      updated_at        = now()
    WHERE id = v_existing_id;

    -- Sleep until process_after (or 0 if already past)
    v_sleep_ms := GREATEST(0,
      EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000
    )::integer;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;

  ELSE
    -- ── New burst: create a fresh entry ──────────────────────────────────────
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until    := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);

    -- Respect max_wait from the start
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

-- ─── Function 2: wa_queue_claim ──────────────────────────────────────────────
--
-- ATOMIC claim. Called after sleep window expires.
-- Uses optimistic locking: only succeeds if entry is still 'pending'/'waiting'
-- AND process_after has elapsed.
--
-- If two workers race here (multi-instance deployment), only ONE will update
-- because the WHERE clause will match for only one of them.
-- The second UPDATE will affect 0 rows → returns claimed=false → worker exits.

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
  -- Atomic state transition: pending/waiting → processing
  -- Condition: must still be pending/waiting AND delay must have elapsed
  WITH updated AS (
    UPDATE wa_conversation_queue
    SET
      status          = 'processing',
      worker_id       = p_worker_id,
      started_at      = now(),
      locked_at       = now(),
      -- Worker has 28 seconds to complete (heartbeat extends this)
      lock_expires_at = now() + interval '28 seconds',
      heartbeat_at    = now(),
      attempt         = attempt + 1,
      updated_at      = now()
    WHERE id     = p_entry_id
      AND status IN ('pending', 'waiting')
      AND process_after <= now()        -- delay window has elapsed
    RETURNING *
  )
  SELECT COUNT(*) INTO v_rows_updated FROM updated;

  IF v_rows_updated = 0 THEN
    -- Claim failed: either superseded, already claimed, or delay not yet elapsed
    RETURN QUERY SELECT false, 0, ''::text, 0;
    RETURN;
  END IF;

  -- Return claimed entry details
  RETURN QUERY
  SELECT
    true,
    q.message_count,
    q.last_message_body,
    q.attempt
  FROM wa_conversation_queue q
  WHERE q.id = p_entry_id;
END;
$$;

-- ─── Function 3: wa_queue_claim_retry ────────────────────────────────────────
--
-- Same as wa_queue_claim but for 'retrying' entries.
-- Called when a new message arrives and there's a retrying entry waiting.

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

-- ─── Function 4: wa_queue_heartbeat ──────────────────────────────────────────
--
-- Called by the worker during long AI operations.
-- Extends the lock so zombie cleanup doesn't prematurely kill a live worker.
-- Returns false if another worker somehow claimed this entry (fail-safe).

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

-- ─── Function 5: wa_queue_complete ───────────────────────────────────────────
--
-- Called by the worker AFTER successfully sending the reply.
-- Only the claiming worker (matching worker_id) can complete.

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

-- ─── Function 6: wa_queue_fail ───────────────────────────────────────────────
--
-- Called when AI or send fails.
-- If attempts remain: transitions to 'retrying' with exponential backoff.
-- If max attempts reached: transitions to 'failed'.
-- Returns the new status string ('retrying' or 'failed').

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
    -- Exponential backoff: 2^attempt seconds (2s, 4s, 8s)
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

-- ─── Function 7: wa_queue_cleanup_zombies ────────────────────────────────────
--
-- Resets 'processing' entries whose lock_expires_at has passed.
-- Called on every webhook request (fast — uses the lock_expires index).
-- Also picks up 'pending'/'waiting' entries past max_wait_until (shouldn't
-- happen normally, but catches edge cases after server restarts).
-- Returns number of entries cleaned up.

CREATE OR REPLACE FUNCTION wa_queue_cleanup_zombies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Reset zombie workers (processing but lock expired)
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

  -- Also clean up stale pending/waiting past max_wait_until (belt-and-suspenders)
  -- These get marked 'failed' so a new message will start fresh
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

-- ─── Function 8: wa_queue_get_retrying ───────────────────────────────────────
--
-- Returns a retrying entry that is ready for pickup (next_retry_at elapsed).
-- Called when a new message arrives — gives us a chance to immediately retry
-- rather than waiting for the next cleanup cycle.

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

-- ─── Monitoring view ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW wa_queue_stats AS
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

-- ─── Grants ───────────────────────────────────────────────────────────────────

-- Table: grant to both anon (webhook uses anon key) and service_role
GRANT ALL     ON TABLE   wa_conversation_queue                                        TO anon;
GRANT ALL     ON TABLE   wa_conversation_queue                                        TO service_role;
GRANT SELECT  ON         wa_queue_stats                                               TO service_role;

-- Functions
GRANT EXECUTE ON FUNCTION wa_queue_upsert(text,uuid,uuid,text,integer,integer)        TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_claim(uuid,text)                                   TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_claim_retry(uuid,text)                             TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_heartbeat(uuid,text)                               TO service_role;
GRANT EXECUTE ON FUNCTION wa_queue_heartbeat(uuid,text)                               TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_complete(uuid,text,text)                           TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_fail(uuid,text,text)                               TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_cleanup_zombies()                                  TO anon;
GRANT EXECUTE ON FUNCTION wa_queue_get_retrying(text)                                 TO anon;

-- ─── Backward compatibility note ─────────────────────────────────────────────
-- wa_message_queue (v1) is kept intact but no longer used by the webhook.
-- The v1 functions (claim_queue_winner, is_still_winner, mark_queue_done) are
-- also kept. They can be dropped after confirming v2 is stable.
