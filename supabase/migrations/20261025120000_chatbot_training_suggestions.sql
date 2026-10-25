-- Usulan data training dari balasan staf (manusia) di WhatsApp.
-- Tidak pernah aktif otomatis: admin meninjau di /admin/training-suggestions,
-- baru saat "Setujui" baris disalin ke chatbot_training_examples (is_active)
-- dan cron embedding 5 menit mengindeksnya. Tidak mengubah data lama.
CREATE TABLE IF NOT EXISTS public.chatbot_training_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  source_message_id uuid NOT NULL,
  guest_question text NOT NULL,
  staff_answer text NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  training_example_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  CONSTRAINT chatbot_training_suggestions_source_key UNIQUE (source_message_id),
  CONSTRAINT chatbot_training_suggestions_dedupe_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS chatbot_training_suggestions_status_idx
  ON public.chatbot_training_suggestions (status, created_at DESC);

ALTER TABLE public.chatbot_training_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read training suggestions" ON public.chatbot_training_suggestions;
CREATE POLICY "staff read training suggestions" ON public.chatbot_training_suggestions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff insert pending training suggestions" ON public.chatbot_training_suggestions;
CREATE POLICY "staff insert pending training suggestions" ON public.chatbot_training_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND status = 'pending');

DROP POLICY IF EXISTS "admin review training suggestions" ON public.chatbot_training_suggestions;
CREATE POLICY "admin review training suggestions" ON public.chatbot_training_suggestions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
