-- Alert handoff admin + permintaan ubah booking (PR #103) butuh event_type baru.
-- Tanpa ini insert notification_logs gagal dan WhatsApp ke admin tidak dikirim.
ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_event_type_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'new_booking','payment_proof','complaint','new_session','new_message','bot_loop',
    'zombie_timeout','booking_stuck','rpc_failure','booking_expired','booking_updated',
    'ai_credit_low','booking_write_failed','booking_change_request','admin_handoff'
  ]::text[]));
