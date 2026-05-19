-- Enable Supabase Realtime for WhatsApp tables so the inbox
-- updates live without a page refresh. Idempotent — safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_threads;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;
