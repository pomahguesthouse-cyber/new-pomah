CREATE TABLE public.chatbot_training_examples (
  id text PRIMARY KEY,
  stage text,
  state_before text,
  user_message text NOT NULL,
  intent text,
  slot_updates jsonb,
  ideal_assistant_response text NOT NULL,
  source_file text,
  training_type text,
  language text DEFAULT 'id-ID',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatbot_training_examples TO authenticated;
GRANT ALL ON public.chatbot_training_examples TO service_role;

ALTER TABLE public.chatbot_training_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage training examples"
  ON public.chatbot_training_examples
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_chatbot_training_active ON public.chatbot_training_examples(is_active, intent, stage);

CREATE TRIGGER trg_chatbot_training_updated_at
  BEFORE UPDATE ON public.chatbot_training_examples
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();