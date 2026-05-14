ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_conversation_logs;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_threads REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
ALTER TABLE public.ai_conversation_logs REPLICA IDENTITY FULL;