-- ============================================================
-- WhatsApp Correction Dataset
-- ============================================================
-- Purpose:
--   Store corrections from REAL WhatsApp conversations, not only simulator
--   conversations. Each row captures:
--     - the actual guest message
--     - the wrong bot reply
--     - the ideal admin-approved reply
--     - conversation context before the mistake
--     - correct intent/agent/error type
--   The dataset is retrievable by vector similarity and injected into prompts
--   as both positive examples and "do not repeat this mistake" examples.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wa_correction_dataset (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_phone         text,
  thread_id               uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  user_message_id         uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  wrong_reply_message_id  uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  user_message            text NOT NULL,
  bot_wrong_reply         text NOT NULL,
  ideal_reply             text NOT NULL,
  context_before          jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_intent          text,
  correct_agent           text,
  error_type              text,
  severity                text NOT NULL DEFAULT 'medium'
                          CHECK (severity IN ('low','medium','high','critical')),
  status                  text NOT NULL DEFAULT 'approved'
                          CHECK (status IN ('draft','approved','archived')),
  notes                   text,
  source                  text NOT NULL DEFAULT 'whatsapp',
  embedding               vector(1536),
  embedding_updated_at    timestamptz,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(user_message) <> ''),
  CHECK (btrim(bot_wrong_reply) <> ''),
  CHECK (btrim(ideal_reply) <> '')
);

CREATE INDEX IF NOT EXISTS idx_wa_correction_dataset_thread
  ON public.wa_correction_dataset (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_correction_dataset_phone
  ON public.wa_correction_dataset (canonical_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_correction_dataset_status
  ON public.wa_correction_dataset (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_correction_dataset_intent_agent
  ON public.wa_correction_dataset (correct_intent, correct_agent)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS wa_correction_dataset_embedding_idx
  ON public.wa_correction_dataset
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.touch_wa_correction_dataset_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_wa_correction_dataset ON public.wa_correction_dataset;
CREATE TRIGGER trg_touch_wa_correction_dataset
BEFORE UPDATE ON public.wa_correction_dataset
FOR EACH ROW EXECUTE FUNCTION public.touch_wa_correction_dataset_updated_at();

-- Create a correction row directly from the real WhatsApp message IDs.
-- p_user_message_id should point to the guest's inbound message.
-- p_wrong_reply_message_id should point to the wrong outbound bot reply.
CREATE OR REPLACE FUNCTION public.create_wa_correction_from_messages(
  p_user_message_id        uuid,
  p_wrong_reply_message_id uuid,
  p_ideal_reply            text,
  p_correct_intent         text DEFAULT NULL,
  p_correct_agent          text DEFAULT NULL,
  p_error_type             text DEFAULT NULL,
  p_severity               text DEFAULT 'medium',
  p_notes                  text DEFAULT NULL,
  p_status                 text DEFAULT 'approved'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_msg record;
  v_wrong_msg record;
  v_phone text;
  v_context jsonb := '[]'::jsonb;
  v_id uuid;
  v_severity text := COALESCE(NULLIF(btrim(p_severity), ''), 'medium');
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'approved');
BEGIN
  IF NULLIF(btrim(p_ideal_reply), '') IS NULL THEN
    RAISE EXCEPTION 'ideal_reply wajib diisi';
  END IF;

  SELECT m.id, m.thread_id, m.direction, m.body, m.sent_at, t.phone
    INTO v_user_msg
  FROM public.whatsapp_messages m
  JOIN public.whatsapp_threads t ON t.id = m.thread_id
  WHERE m.id = p_user_message_id;

  IF v_user_msg.id IS NULL THEN
    RAISE EXCEPTION 'user message tidak ditemukan';
  END IF;
  IF v_user_msg.direction <> 'in' THEN
    RAISE EXCEPTION 'user_message_id harus pesan inbound tamu';
  END IF;

  SELECT m.id, m.thread_id, m.direction, m.body, m.sent_at
    INTO v_wrong_msg
  FROM public.whatsapp_messages m
  WHERE m.id = p_wrong_reply_message_id;

  IF v_wrong_msg.id IS NULL THEN
    RAISE EXCEPTION 'wrong reply message tidak ditemukan';
  END IF;
  IF v_wrong_msg.direction <> 'out' THEN
    RAISE EXCEPTION 'wrong_reply_message_id harus pesan outbound bot/admin';
  END IF;
  IF v_wrong_msg.thread_id <> v_user_msg.thread_id THEN
    RAISE EXCEPTION 'user message dan wrong reply harus dalam thread yang sama';
  END IF;

  IF v_severity NOT IN ('low','medium','high','critical') THEN
    v_severity := 'medium';
  END IF;
  IF v_status NOT IN ('draft','approved','archived') THEN
    v_status := 'approved';
  END IF;

  v_phone := public.resolve_wa_canonical_phone(v_user_msg.phone);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'direction', direction,
      'body', body,
      'sent_at', sent_at
    ) ORDER BY sent_at ASC
  ), '[]'::jsonb)
    INTO v_context
  FROM (
    SELECT id, direction, body, sent_at
    FROM public.whatsapp_messages
    WHERE thread_id = v_user_msg.thread_id
      AND sent_at <= v_wrong_msg.sent_at
    ORDER BY sent_at DESC
    LIMIT 14
  ) s;

  INSERT INTO public.wa_correction_dataset (
    canonical_phone,
    thread_id,
    user_message_id,
    wrong_reply_message_id,
    user_message,
    bot_wrong_reply,
    ideal_reply,
    context_before,
    correct_intent,
    correct_agent,
    error_type,
    severity,
    status,
    notes,
    source
  ) VALUES (
    v_phone,
    v_user_msg.thread_id,
    v_user_msg.id,
    v_wrong_msg.id,
    v_user_msg.body,
    v_wrong_msg.body,
    btrim(p_ideal_reply),
    v_context,
    NULLIF(btrim(p_correct_intent), ''),
    NULLIF(btrim(p_correct_agent), ''),
    NULLIF(btrim(p_error_type), ''),
    v_severity,
    v_status,
    NULLIF(btrim(p_notes), ''),
    'whatsapp'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Recent outbound replies paired with the nearest previous inbound message.
-- Admin UI can use this to choose the exact turn to correct.
CREATE OR REPLACE FUNCTION public.list_wa_correction_candidates(p_limit int DEFAULT 40)
RETURNS TABLE (
  thread_id uuid,
  phone text,
  display_name text,
  user_message_id uuid,
  user_message text,
  user_sent_at timestamptz,
  wrong_reply_message_id uuid,
  bot_wrong_reply text,
  bot_sent_at timestamptz,
  agent_key text,
  intent text,
  tools_used jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    t.id AS thread_id,
    t.phone,
    t.display_name,
    prev_in.id AS user_message_id,
    prev_in.body AS user_message,
    prev_in.sent_at AS user_sent_at,
    outm.id AS wrong_reply_message_id,
    outm.body AS bot_wrong_reply,
    outm.sent_at AS bot_sent_at,
    COALESCE(outm.metadata ->> 'agent_key', outm.metadata ->> 'agent') AS agent_key,
    outm.metadata ->> 'intent' AS intent,
    COALESCE(outm.metadata -> 'tools_used', '[]'::jsonb) AS tools_used
  FROM public.whatsapp_messages outm
  JOIN public.whatsapp_threads t ON t.id = outm.thread_id
  JOIN LATERAL (
    SELECT im.id, im.body, im.sent_at
    FROM public.whatsapp_messages im
    WHERE im.thread_id = outm.thread_id
      AND im.direction = 'in'
      AND im.sent_at <= outm.sent_at
    ORDER BY im.sent_at DESC
    LIMIT 1
  ) prev_in ON true
  WHERE outm.direction = 'out'
    AND COALESCE(outm.metadata ->> 'simulator', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1
      FROM public.wa_correction_dataset c
      WHERE c.wrong_reply_message_id = outm.id
    )
  ORDER BY outm.sent_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 200));
$$;

-- Positive retrieval: use the ideal reply as an approved example.
CREATE OR REPLACE FUNCTION public.match_wa_correction_ideal_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  user_message text,
  ideal_assistant_response text,
  intent text,
  stage text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    c.user_message,
    c.ideal_reply AS ideal_assistant_response,
    c.correct_intent AS intent,
    c.correct_agent AS stage,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.wa_correction_dataset c
  WHERE c.embedding IS NOT NULL
    AND c.status = 'approved'
    AND c.user_message IS NOT NULL
    AND c.ideal_reply IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Negative retrieval: expose the wrong reply + correction so the prompt can say
-- "do not answer like this; answer like that".
CREATE OR REPLACE FUNCTION public.match_wa_correction_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 2
)
RETURNS TABLE (
  id uuid,
  user_message text,
  bad_response text,
  correction text,
  correct_intent text,
  correct_agent text,
  error_type text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    c.user_message,
    c.bot_wrong_reply AS bad_response,
    c.ideal_reply AS correction,
    c.correct_intent,
    c.correct_agent,
    c.error_type,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.wa_correction_dataset c
  WHERE c.embedding IS NOT NULL
    AND c.status = 'approved'
    AND c.user_message IS NOT NULL
    AND c.bot_wrong_reply IS NOT NULL
    AND c.ideal_reply IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.create_wa_correction_from_messages(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_wa_correction_candidates(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_wa_correction_ideal_examples(vector, float, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_wa_correction_examples(vector, float, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_wa_correction_from_messages(uuid, uuid, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_wa_correction_candidates(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_wa_correction_ideal_examples(vector, float, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_wa_correction_examples(vector, float, int) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_correction_dataset TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
