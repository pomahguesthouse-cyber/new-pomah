
-- RPC: cari contoh negatif (jawaban buruk + koreksi) berdasarkan kemiripan vektor
CREATE OR REPLACE FUNCTION public.match_bad_training_examples(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 2
)
RETURNS TABLE (
  id uuid,
  user_message text,
  bad_response text,
  correction text,
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
    l.ai_response          AS bad_response,
    NULLIF(btrim(l.correction), '') AS correction,
    1 - (l.embedding <=> query_embedding) AS similarity
  FROM public.ai_conversation_logs l
  WHERE l.embedding IS NOT NULL
    AND l.rating = 'bad'
    AND l.user_message IS NOT NULL
    AND l.ai_response  IS NOT NULL
    AND 1 - (l.embedding <=> query_embedding) >= match_threshold
  ORDER BY l.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_bad_training_examples(vector, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_bad_training_examples(vector, float, int) TO authenticated, service_role;
