-- Performance: whatsapp_threads.phone and guests.phone are looked up on every
-- inbound/outbound WhatsApp webhook event (thread resolution, guest resolution)
-- but had no index, forcing a sequential scan per message. Add btree indexes.

CREATE INDEX IF NOT EXISTS idx_whatsapp_threads_phone
  ON public.whatsapp_threads (phone);

CREATE INDEX IF NOT EXISTS idx_guests_phone
  ON public.guests (phone);
