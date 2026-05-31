-- Add embedding + effective_answer columns to ai_conversation_logs for RAG-based training retrieval
ALTER TABLE public.ai_conversation_logs
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS effective_answer text
    GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(correction), ''), ai_response)) STORED,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

-- HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS ai_conversation_logs_embedding_idx
  ON public.ai_conversation_logs
  USING hnsw (embedding vector_cosine_ops);

-- Retrieval function: only good + used examples with embedding
CREATE OR REPLACE FUNCTION public.match_training_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  user_message text,
  effective_answer text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.user_message,
    l.effective_answer,
    1 - (l.embedding <=> query_embedding) AS similarity
  FROM public.ai_conversation_logs l
  WHERE l.embedding IS NOT NULL
    AND l.rating = 'good'
    AND l.used = true
    AND l.user_message IS NOT NULL
    AND l.effective_answer IS NOT NULL
    AND 1 - (l.embedding <=> query_embedding) >= match_threshold
  ORDER BY l.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_training_examples(vector, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_training_examples(vector, float, int) TO authenticated, service_role;