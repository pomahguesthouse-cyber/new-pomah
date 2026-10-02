-- Fix: trigger seed_whatsapp_context_summary() menimpa ringkasan percakapan.
--
-- Masalah (terdiagnosa di database live): setiap INSERT ke whatsapp_messages
-- menimpa chat_summary / chat_summary_json dengan seed kosong
-- ('Auto generated summary', source auto_seed) dan memaksa
-- chat_summary_updated_at = now(). Akibatnya nama, tipe kamar, tanggal, dan
-- jumlah tamu tidak pernah bertahan dan bot menanyakan ulang data yang sama.
--
-- Perbaikan:
--   * Seed HANYA bila chat_summary_json masih NULL / bukan object / '{}' /
--     tanpa source & short_summary.
--   * Ringkasan yang sudah ada (terutama source 'llm') tidak pernah ditimpa.
--   * chat_summary_updated_at hanya diisi pada seed pertama.
--   * Nama trigger, signature fungsi, SECURITY DEFINER, search_path, dan grants
--     tidak berubah. Idempoten (CREATE OR REPLACE). Tidak mengubah data lama.

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

  -- Muat state ringkasan saat ini + flag ai_auto.
  SELECT
    COALESCE(chat_summary_json, '{}'::jsonb),
    COALESCE(chat_summary, ''),
    COALESCE(ai_auto, true),
    COALESCE(chat_summary_version, 0) + 1
  INTO
    v_existing_json,
    v_existing_summary,
    v_ai_auto,
    v_next_version
  FROM public.whatsapp_threads
  WHERE id = NEW.thread_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- SEED HANYA SEKALI. Ringkasan yang sudah ada (source 'llm', 'manual',
  -- 'auto_seed', 'human_takeover_auto', dll.) TIDAK PERNAH ditimpa dan
  -- chat_summary_updated_at tidak disentuh. Sebelumnya seed menimpa ringkasan
  -- LLM di setiap pesan sehingga konteks percakapan (nama, tipe kamar, tanggal,
  -- jumlah tamu) hilang dan bot menanyakan ulang.
  IF NOT (
       jsonb_typeof(v_existing_json) IS DISTINCT FROM 'object'
       OR v_existing_json = '{}'::jsonb
       OR (
         COALESCE(v_existing_json ->> 'source', '') = ''
         AND COALESCE(v_existing_json ->> 'short_summary', '') = ''
       )
     )
  THEN
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
    chat_summary = COALESCE(NULLIF(v_existing_summary, ''), v_short_summary),
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
  WHERE id = NEW.thread_id
    -- Guard atomik: jangan menimpa bila trigger/summarizer lain sudah mengisi
    -- ringkasan di antara SELECT di atas dan UPDATE ini.
    AND (
      chat_summary_json IS NULL
      OR jsonb_typeof(chat_summary_json) IS DISTINCT FROM 'object'
      OR chat_summary_json = '{}'::jsonb
      OR (
        COALESCE(chat_summary_json ->> 'source', '') = ''
        AND COALESCE(chat_summary_json ->> 'short_summary', '') = ''
      )
    );

  RETURN NEW;
END;
$$;

-- Trigger dibuat ulang hanya bila belum ada (nama & definisi tetap).
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_seed_whatsapp_context_summary'
      AND tgrelid = 'public.whatsapp_messages'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_seed_whatsapp_context_summary
    AFTER INSERT ON public.whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.seed_whatsapp_context_summary();
  END IF;
END
$mig$;

REVOKE ALL ON FUNCTION public.seed_whatsapp_context_summary() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_whatsapp_context_summary() TO service_role;
