-- Embedding training + chunk SOP yang tertinggal NULL diisi ulang lewat
-- cron. Lovable tidak menjalankan file ini. Tempel seluruh isi ke SQL editor
-- Supabase setelah deploy.
--
-- Jadwal: tiap 5 menit.
-- URL: https://pomahguesthouse.com/api/cron/backfill-training-embeddings

ALTER TABLE public.chatbot_training_examples
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

ALTER TABLE public.ai_conversation_logs
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

ALTER TABLE public.wa_correction_dataset
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

ALTER TABLE public.wa_correction_sessions
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

ALTER TABLE public.sop_documents
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.sop_documents
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_sop_documents_content_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sop_documents_content_updated_at ON public.sop_documents;
DROP TRIGGER IF EXISTS trg_sop_documents_content_inserted_at ON public.sop_documents;
CREATE TRIGGER trg_sop_documents_content_inserted_at
  BEFORE INSERT ON public.sop_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_sop_documents_content_updated_at();
CREATE TRIGGER trg_sop_documents_content_updated_at
  BEFORE UPDATE OF content ON public.sop_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_sop_documents_content_updated_at();

-- Health check memanggil fungsi ini. Isinya membaca pg_extension.
CREATE OR REPLACE FUNCTION public.has_pgvector_extension()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'vector'
  );
$$;

REVOKE ALL ON FUNCTION public.has_pgvector_extension() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_pgvector_extension() TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-training-embeddings') THEN
    PERFORM cron.unschedule('backfill-training-embeddings');
  END IF;

  PERFORM cron.schedule(
    'backfill-training-embeddings',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url                  := 'https://pomahguesthouse.com/api/cron/backfill-training-embeddings',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END;
$migration$;

-- Inspeksi:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'backfill-training-embeddings';
--   SELECT cron.unschedule('backfill-training-embeddings');
