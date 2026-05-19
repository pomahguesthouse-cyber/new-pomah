-- Enable Supabase Realtime for WhatsApp tables so the inbox
-- updates live without a page refresh.
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
