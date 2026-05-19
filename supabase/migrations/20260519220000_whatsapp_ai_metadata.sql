-- Add AI analysis metadata and training flag to whatsapp_threads.
-- ai_analysis stores the result of the last "Analisis AI" run:
--   { intent_label, confidence, agent, tools_used[], analyzed_at }
-- is_training_example marks the thread as a training data sample.

ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS ai_analysis   jsonb,
  ADD COLUMN IF NOT EXISTS is_training_example boolean NOT NULL DEFAULT false;
