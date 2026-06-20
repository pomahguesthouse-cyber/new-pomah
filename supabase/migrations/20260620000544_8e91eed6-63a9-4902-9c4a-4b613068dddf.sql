-- P1: Hybrid retrieval for chatbot training examples
-- Add vector embedding to curated examples so they can be retrieved
-- by semantic similarity alongside ai_conversation_logs.

ALTER TABLE public.chatbot_training_examples
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_from_log_id uuid;

-- HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS chatbot_training_examples_embedding_idx
  ON public.chatbot_training_examples
  USING hnsw (embedding vector_cosine_ops);

-- Retrieval function for curated examples (active + has embedding)
CREATE OR REPLACE FUNCTION public.match_chatbot_training_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.72,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id text,
  user_message text,
  ideal_assistant_response text,
  intent text,
  stage text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.user_message,
    e.ideal_assistant_response,
    e.intent,
    e.stage,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.chatbot_training_examples e
  WHERE e.embedding IS NOT NULL
    AND e.is_active = true
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_chatbot_training_examples(vector, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chatbot_training_examples(vector, float, int) TO authenticated, service_role;