-- whatsapp_messages.from_me selalu NULL untuk pesan baru (RPC inbound &
-- save_outbound_whatsapp tidak mengisinya) dan whatsapp_threads.last_message_at
-- tertinggal bila outbound ditulis di luar save_outbound_whatsapp.
-- Satu tempat untuk semua penulis (RPC, server, edge function): trigger.

CREATE OR REPLACE FUNCTION public.tg_wa_message_from_me_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.from_me IS NULL THEN
    NEW.from_me := (NEW.direction = 'out');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_message_from_me_default ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_message_from_me_default
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_wa_message_from_me_default();

CREATE OR REPLACE FUNCTION public.tg_wa_message_touch_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_at timestamptz := COALESCE(NEW.sent_at, now());
BEGIN
  -- Catatan sistem internal (mis. "[sistem] AI dinonaktifkan") tidak menggeser urutan inbox.
  IF COALESCE(NEW.metadata->>'is_system_command', 'false') = 'true' THEN
    RETURN NULL;
  END IF;
  UPDATE public.whatsapp_threads
     SET last_message_at = v_at
   WHERE id = NEW.thread_id
     AND (last_message_at IS NULL OR last_message_at < v_at);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_message_touch_thread ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_message_touch_thread
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_wa_message_touch_thread();
