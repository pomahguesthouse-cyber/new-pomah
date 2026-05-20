-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create sop_chunks table
CREATE TABLE IF NOT EXISTS public.sop_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.sop_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_url TEXT,
    embedding vector(1536), -- Default size for text-embedding-3-small and text-embedding-ada-002
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.sop_chunks ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view chunks (since they are queried from server functions)
CREATE POLICY "Enable read access for authenticated users on sop_chunks"
    ON public.sop_chunks FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated admins to insert/update/delete (or rely on postgres role via service role key)
CREATE POLICY "Enable write access for authenticated users on sop_chunks"
    ON public.sop_chunks FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create an HNSW index on the embedding column for fast approximate search
CREATE INDEX ON public.sop_chunks USING hnsw (embedding vector_cosine_ops);

-- Create the semantic search RPC function
CREATE OR REPLACE FUNCTION match_sop_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  source_url text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sop_chunks.id,
    sop_chunks.document_id,
    sop_chunks.content,
    sop_chunks.source_url,
    1 - (sop_chunks.embedding <=> query_embedding) AS similarity
  FROM sop_chunks
  WHERE 1 - (sop_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY sop_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
