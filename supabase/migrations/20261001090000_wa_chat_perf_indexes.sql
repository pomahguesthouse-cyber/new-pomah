-- Performa chat WhatsApp admin (/admin/whatsapp). Hanya INDEX baru, tanpa
-- perubahan skema/kolom/data. Aman dijalankan ulang (IF NOT EXISTS).

-- Daftar thread: ORDER BY pinned DESC, last_message_at DESC LIMIT n
CREATE INDEX IF NOT EXISTS idx_whatsapp_threads_inbox_order
  ON public.whatsapp_threads (pinned DESC, last_message_at DESC);

-- Badge total belum dibaca: thread dengan unread_count > 0 (sedikit baris)
CREATE INDEX IF NOT EXISTS idx_whatsapp_threads_unread
  ON public.whatsapp_threads (unread_count)
  WHERE unread_count > 0;

-- Pesan masuk terakhir per thread (jendela 24 jam Meta di composer)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_thread_dir_sent
  ON public.whatsapp_messages (thread_id, direction, sent_at DESC);

-- Panel tamu: booking terbaru per tamu
CREATE INDEX IF NOT EXISTS idx_bookings_guest_checkin
  ON public.bookings (guest_id, check_in DESC);
