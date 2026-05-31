ALTER TABLE public.ai_conversation_logs
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS transcript jsonb;

DELETE FROM public.ai_conversation_logs WHERE source = 'simulator';