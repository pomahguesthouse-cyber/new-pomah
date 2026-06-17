-- Improve WhatsApp Context Summary for Human Takeover threads.
--
-- The app-side LLM summarizer is triggered from the AI autoreply path. When
-- ai_auto=false (human takeover), that path intentionally returns early, so the
-- admin sidebar can remain empty. This migration makes the DB trigger aware of
-- human-takeover conversations and keeps a structured context summary available
-- immediately after messages are inserted. The LLM/manual Regenerate action can
-- still replace this seeded summary with richer structured data later.

ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS chat_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS chat_summary_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS chat_summary_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.seed_whatsapp_context_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_count integer := 0;
  v_last_inbound text := '';
  v_last_message text := '';
  v_combined text := '';
  v_existing_json jsonb := '{}'::jsonb;
  v_existing_summary text := '';
  v_existing_updated_at timestamptz;
  v_ai_auto boolean := true;
  v_next_version integer := 1;
  v_source text := 'auto_seed';
  v_room_type text := NULL;
  v_last_topic text := 'general';
  v_payment_status text := NULL;
  v_booking_status text := NULL;
  v_complaint_active boolean := false;
  v_needs_human boolean := false;
  v_unresolved_question text := NULL;
  v_short_summary text := '';
BEGIN
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_message_count
  FROM public.whatsapp_messages
  WHERE thread_id = NEW.thread_id;

  -- Below 3 messages, the sidebar would be mostly noise.
  IF v_message_count < 3 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(body, '')
  INTO v_last_message
  FROM public.whatsapp_messages
  WHERE thread_id = NEW.thread_id
  ORDER BY sent_at DESC
  LIMIT 1;

  SELECT COALESCE(body, '')
  INTO v_last_inbound
  FROM public.whatsapp_messages
  WHERE thread_id = NEW.thread_id
    AND direction = 'in'
  ORDER BY sent_at DESC
  LIMIT 1;

  SELECT COALESCE(string_agg(body, ' ' ORDER BY sent_at DESC), '')
  INTO v_combined
  FROM (
    SELECT body, sent_at
    FROM public.whatsapp_messages
    WHERE thread_id = NEW.thread_id
    ORDER BY sent_at DESC
    LIMIT 12
  ) recent;

  SELECT
    COALESCE(chat_summary_json, '{}'::jsonb),
    COALESCE(chat_summary, ''),
    chat_summary_updated_at,
    COALESCE(ai_auto, true),
    COALESCE(chat_summary_version, 0) + 1
  INTO
    v_existing_json,
    v_existing_summary,
    v_existing_updated_at,
    v_ai_auto,
    v_next_version
  FROM public.whatsapp_threads
  WHERE id = NEW.thread_id;

  -- Respect a fresh LLM/manual structured summary unless this is a human-takeover
  -- thread. Human takeover needs the seed to keep the sidebar live because the
  -- normal AI autoreply summarizer is not invoked.
  IF v_ai_auto = true
     AND jsonb_typeof(v_existing_json) = 'object'
     AND COALESCE(v_existing_json ->> 'source', '') NOT IN ('auto_seed', 'human_takeover_auto')
     AND COALESCE(v_existing_json ->> 'short_summary', '') <> ''
     AND v_existing_updated_at > now() - interval '10 minutes'
  THEN
    RETURN NEW;
  END IF;

  IF v_ai_auto = false THEN
    v_source := 'human_takeover_auto';
  END IF;

  -- Lightweight deterministic extraction so context fields are useful even
  -- before the LLM Regenerate button runs.
  IF v_combined ~* 'family' THEN
    v_room_type := 'Family';
  ELSIF v_combined ~* 'deluxe' THEN
    v_room_type := 'Deluxe';
  ELSIF v_combined ~* 'single' THEN
    v_room_type := 'Single';
  END IF;

  IF v_combined ~* '(transfer|bayar|pembayaran|bukti|invoice|dp)' THEN
    v_last_topic := 'payment';
    IF v_combined ~* '(sudah.*transfer|sudah.*bayar|lunas|paid)' THEN
      v_payment_status := 'paid';
    ELSE
      v_payment_status := 'unpaid';
    END IF;
  ELSIF v_combined ~* '(booking|reservasi|pesan kamar|check[- ]?in|check[- ]?out)' THEN
    v_last_topic := 'booking';
    v_booking_status := 'pending';
  ELSIF v_combined ~* '(harga|tarif|rate|berapa)' THEN
    v_last_topic := 'pricing';
  ELSIF v_combined ~* '(tersedia|available|kosong|penuh|tanggal)' THEN
    v_last_topic := 'availability';
  ELSIF v_combined ~* '(lokasi|alamat|maps|arah)' THEN
    v_last_topic := 'location';
  ELSIF v_combined ~* '(fasilitas|wifi|parkir|ac|kamar mandi)' THEN
    v_last_topic := 'facility';
  END IF;

  IF v_combined ~* '(komplain|keluhan|rusak|kotor|bau|tidak bisa|nggak bisa|ga bisa)' THEN
    v_last_topic := 'complaint';
    v_complaint_active := true;
    v_needs_human := true;
  END IF;

  IF v_last_inbound LIKE '%?' THEN
    v_unresolved_question := LEFT(v_last_inbound, 240);
  END IF;

  v_short_summary := CASE
    WHEN v_ai_auto = false THEN
      'Human takeover aktif. Percakapan tetap diringkas otomatis. Pesan terakhir tamu: ' || LEFT(COALESCE(NULLIF(v_last_inbound, ''), v_last_message), 220)
    ELSE
      'Percakapan WhatsApp aktif. Pesan terakhir tamu: ' || LEFT(COALESCE(NULLIF(v_last_inbound, ''), v_last_message), 220)
  END;

  UPDATE public.whatsapp_threads
  SET
    chat_summary = v_short_summary,
    chat_summary_json = jsonb_build_object(
      'source', v_source,
      'short_summary', v_short_summary,
      'guest_name', NULL,
      'last_topic', v_last_topic,
      'room_type', v_room_type,
      'check_in', NULL,
      'check_out', NULL,
      'guest_count', NULL,
      'booking_status', v_booking_status,
      'payment_status', v_payment_status,
      'complaint_active', v_complaint_active,
      'unresolved_question', v_unresolved_question,
      'needs_human', v_needs_human,
      'handoff_reason', CASE WHEN v_ai_auto = false THEN 'AI Auto nonaktif / Human Takeover' ELSE NULL END
    ),
    chat_summary_version = v_next_version,
    chat_summary_updated_at = now()
  WHERE id = NEW.thread_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_whatsapp_context_summary ON public.whatsapp_messages;
CREATE TRIGGER trg_seed_whatsapp_context_summary
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.seed_whatsapp_context_summary();

REVOKE ALL ON FUNCTION public.seed_whatsapp_context_summary() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_whatsapp_context_summary() TO service_role;