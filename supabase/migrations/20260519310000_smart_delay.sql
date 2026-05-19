-- ============================================================
-- Smart Response Delay Engine
-- ============================================================
-- Adds:
--   1. wa_message_queue        — DB-backed queue for debouncing AI replies
--   2. claim_queue_winner()    — atomically supersedes older pending entries
--   3. is_still_winner()       — checks if this entry is still active
--   4. mark_queue_done()       — marks entry as processed
--   5. wa_queue_stats_today    — monitoring view
--   6. smart_delay_config col  — per-property timing settings
--   7. Updates get_autoreply_context to expose smart_delay_config
-- ============================================================

-- ─── 1. Queue table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_message_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text        NOT NULL,
  thread_id   uuid        REFERENCES whatsapp_threads(id) ON DELETE CASCADE,
  message_id  uuid        REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  body        text        NOT NULL,
  delay_ms    integer     NOT NULL DEFAULT 3000,
  winner_seq  bigint      NOT NULL,           -- epoch-ms at insert; higher = newer
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','done','superseded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_message_queue_phone_status
  ON wa_message_queue (phone, status);

CREATE INDEX IF NOT EXISTS wa_message_queue_created_at
  ON wa_message_queue (created_at);

-- ─── 2. claim_queue_winner ───────────────────────────────────────────────────
-- Inserts a new queue entry and atomically supersedes all older pending entries
-- for the same phone. Returns the new entry's UUID.

CREATE OR REPLACE FUNCTION claim_queue_winner(
  p_phone      text,
  p_message_id uuid,
  p_body       text,
  p_delay_ms   integer,
  p_thread_id  uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id  uuid;
  v_seq bigint;
BEGIN
  -- Epoch-milliseconds as monotonic sequence
  v_seq := (extract(epoch FROM now()) * 1000)::bigint;

  -- Supersede all earlier pending entries for this phone
  UPDATE wa_message_queue
  SET    status     = 'superseded',
         updated_at = now()
  WHERE  phone  = p_phone
    AND  status = 'pending';

  -- Insert this entry as the current winner
  INSERT INTO wa_message_queue
    (phone, thread_id, message_id, body, delay_ms, winner_seq, status)
  VALUES
    (p_phone, p_thread_id, p_message_id, p_body, p_delay_ms, v_seq, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── 3. is_still_winner ───────────────────────────────────────────────────────
-- Returns TRUE only when the entry is still 'pending' (not superseded).

CREATE OR REPLACE FUNCTION is_still_winner(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT status = 'pending' FROM wa_message_queue WHERE id = p_entry_id),
    false
  );
$$;

-- ─── 4. mark_queue_done ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_queue_done(p_entry_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE wa_message_queue
  SET status = 'done', updated_at = now()
  WHERE id = p_entry_id;
$$;

-- ─── 5. Monitoring view ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW wa_queue_stats_today AS
SELECT
  date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta')  AS hour_wib,
  COUNT(*)                                                      AS total,
  COUNT(*) FILTER (WHERE status = 'done')                       AS replied,
  COUNT(*) FILTER (WHERE status = 'superseded')                 AS superseded,
  COUNT(*) FILTER (WHERE status = 'pending')                    AS still_pending,
  ROUND(AVG(delay_ms) FILTER (WHERE status IN ('done','superseded')))::int AS avg_delay_ms
FROM wa_message_queue
WHERE created_at >= (now() AT TIME ZONE 'Asia/Jakarta')::date AT TIME ZONE 'Asia/Jakarta'
GROUP BY 1
ORDER BY 1 DESC;

-- Grant read access to service role (anon/authenticated already restricted)
GRANT SELECT ON wa_queue_stats_today TO service_role;

-- ─── 6. smart_delay_config column on properties ───────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS smart_delay_config jsonb;

-- ─── 7. Update get_autoreply_context to expose smart_delay_config ─────────────
-- Drop and recreate so the return type picks up the new field.

DROP FUNCTION IF EXISTS get_autoreply_context(text);

CREATE OR REPLACE FUNCTION get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_thread_id       uuid;
  v_auto_reply      boolean := false;
  v_fonnte_token    text    := '';
  v_ai_lab_config   jsonb   := '{}';
  v_smart_delay_cfg jsonb   := NULL;
  v_messages        jsonb   := '[]';
BEGIN
  -- 1. Find the thread for this phone
  SELECT id INTO v_thread_id
  FROM   whatsapp_threads
  WHERE  phone = p_phone
  LIMIT  1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Pull property-level settings
  SELECT
    COALESCE(fonnte_token, ''),
    COALESCE(ai_lab_config, '{}'),
    smart_delay_config
  INTO v_fonnte_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
  LIMIT 1;

  -- 3. Resolve auto_reply from ai_lab_config → agents → front-office → autoReply
  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  );

  -- 4. Last 30 messages for this thread (ascending for LLM context)
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

-- Grant execution to anon (webhook calls use the anon key via supabasePublic)
GRANT EXECUTE ON FUNCTION get_autoreply_context(text)   TO anon;
GRANT EXECUTE ON FUNCTION claim_queue_winner(text,uuid,text,integer,uuid) TO anon;
GRANT EXECUTE ON FUNCTION is_still_winner(uuid)          TO anon;
GRANT EXECUTE ON FUNCTION mark_queue_done(uuid)          TO anon;
GRANT ALL     ON TABLE   wa_message_queue                TO anon;
