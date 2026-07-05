-- ============================================================
-- WhatsApp Correction Sessions
-- ============================================================
-- Conversation-level training layer for real WhatsApp conversations.
-- Keeps the original WhatsApp messages untouched, while storing a corrected
-- transcript and summary that can be retrieved as contextual training memory.
-- ============================================================

ALTER TABLE public.wa_correction_dataset
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS turn_index integer,
  ADD COLUMN IF NOT EXISTS context_after jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.wa_correction_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  canonical_phone      text,
  title                text,
  conversation_summary text,
  full_transcript      jsonb NOT NULL DEFAULT '[]'::jsonb,
  corrected_transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  guest_memory_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status               text NOT NULL DEFAULT 'approved'
                       CHECK (status IN ('draft','approved','archived')),
  source               text NOT NULL DEFAULT 'whatsapp-corrections-ui',
  embedding            vector(1536),
  embedding_updated_at timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wa_correction_dataset_session_id_fkey'
  ) THEN
    ALTER TABLE public.wa_correction_dataset
      ADD CONSTRAINT wa_correction_dataset_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.wa_correction_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_correction_sessions_thread
  ON public.wa_correction_sessions (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_correction_sessions_phone
  ON public.wa_correction_sessions (canonical_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_correction_sessions_status
  ON public.wa_correction_sessions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_correction_sessions_embedding_idx
  ON public.wa_correction_sessions
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_wa_correction_dataset_session
  ON public.wa_correction_dataset (session_id, turn_index);

CREATE OR REPLACE FUNCTION public.touch_wa_correction_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_wa_correction_sessions ON public.wa_correction_sessions;
CREATE TRIGGER trg_touch_wa_correction_sessions
BEFORE UPDATE ON public.wa_correction_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_wa_correction_sessions_updated_at();

CREATE OR REPLACE FUNCTION public.create_wa_correction_session_from_thread(
  p_thread_id uuid,
  p_title text DEFAULT NULL,
  p_conversation_summary text DEFAULT NULL,
  p_corrected_transcript jsonb DEFAULT '[]'::jsonb,
  p_status text DEFAULT 'approved'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_thread record;
  v_full jsonb := '[]'::jsonb;
  v_guest_memory jsonb := '{}'::jsonb;
  v_id uuid;
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'approved');
BEGIN
  SELECT id, phone, display_name, chat_summary_json
    INTO v_thread
  FROM public.whatsapp_threads
  WHERE id = p_thread_id;

  IF v_thread.id IS NULL THEN
    RAISE EXCEPTION 'thread tidak ditemukan';
  END IF;

  IF v_status NOT IN ('draft','approved','archived') THEN
    v_status := 'approved';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'direction', m.direction,
      'body', m.body,
      'sent_at', m.sent_at,
      'metadata', COALESCE(m.metadata, '{}'::jsonb)
    ) ORDER BY m.sent_at ASC
  ), '[]'::jsonb)
    INTO v_full
  FROM public.whatsapp_messages m
  WHERE m.thread_id = p_thread_id;

  IF to_regclass('public.guest_structured_memory') IS NOT NULL THEN
    v_guest_memory := public.get_guest_structured_memory(v_thread.phone);
  END IF;

  INSERT INTO public.wa_correction_sessions (
    thread_id,
    canonical_phone,
    title,
    conversation_summary,
    full_transcript,
    corrected_transcript,
    guest_memory_snapshot,
    status,
    source
  ) VALUES (
    p_thread_id,
    public.resolve_wa_canonical_phone(v_thread.phone),
    COALESCE(NULLIF(btrim(p_title), ''), NULLIF(v_thread.display_name, ''), v_thread.phone),
    NULLIF(btrim(p_conversation_summary), ''),
    v_full,
    COALESCE(p_corrected_transcript, '[]'::jsonb),
    COALESCE(v_guest_memory, '{}'::jsonb),
    v_status,
    'whatsapp-corrections-ui'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_wa_correction_session_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.74,
  match_count int DEFAULT 2
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
    s.id,
    COALESCE(s.conversation_summary, s.title, 'Contoh percakapan WhatsApp terkoreksi') AS user_message,
    LEFT(
      COALESCE(
        s.conversation_summary || E'\n\nTranscript terkoreksi:\n' || s.corrected_transcript::text,
        s.corrected_transcript::text
      ),
      3500
    ) AS ideal_assistant_response,
    'conversation_context'::text AS intent,
    'front-office'::text AS stage,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM public.wa_correction_sessions s
  WHERE s.embedding IS NOT NULL
    AND s.status = 'approved'
    AND COALESCE(s.corrected_transcript, '[]'::jsonb) <> '[]'::jsonb
    AND 1 - (s.embedding <=> query_embedding) >= match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.create_wa_correction_session_from_thread(uuid, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_wa_correction_session_examples(vector, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wa_correction_session_from_thread(uuid, text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_wa_correction_session_examples(vector, float, int) TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_correction_sessions TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
