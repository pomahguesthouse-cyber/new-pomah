-- Auto-seed Context Summary for WhatsApp threads.
--
-- Why:
-- The LLM summarizer runs after AI autoreply and may skip active/human-takeover
-- conversations. This trigger guarantees the admin sidebar has a structured
-- context_summary immediately after enough messages exist. The LLM summarizer can
-- still replace this richer summary later.

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
  v_existing_json jsonb := '{}'::jsonb;
  v_existing_summary text := '';
  v_next_version integer := 1;
BEGIN
  -- Only run for actual message inserts tied to a thread.
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_message_count
  FROM public.whatsapp_messages
  WHERE thread_id = NEW.thread_id;

  -- Keep noise down: below 3 messages, context is usually too thin.
  IF v_message_count < 3 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(body, '')
  INTO v_last_inbound
  FROM public.whatsapp_messages
  WHERE thread_id = NEW.thread_id
    AND direction = 'in'
  ORDER BY sent_at DESC
  LIMIT 1;

  SELECT
    COALESCE(chat_summary_json, '{}'::jsonb),
    COALESCE(chat_summary, ''),
    COALESCE(chat_summary_version, 0) + 1
  INTO v_existing_json, v_existing_summary, v_next_version
  FROM public.whatsapp_threads
  WHERE id = NEW.thread_id;

  -- Do not overwrite a fresh, non-seeded LLM summary too aggressively.
  -- Seeded summaries are marked with source=auto_seed and may be refreshed.
  IF jsonb_typeof(v_existing_json) = 'object'
     AND COALESCE(v_existing_json ->> 'source', '') <> 'auto_seed'
     AND COALESCE(v_existing_json ->> 'short_summary', '') <> ''
     AND (SELECT chat_summary_updated_at FROM public.whatsapp_threads WHERE id = NEW.thread_id) > now() - interval '10 minutes'
  THEN
    RETURN NEW;
  END IF;

  UPDATE public.whatsapp_threads
  SET
    chat_summary = COALESCE(NULLIF(v_existing_summary, ''), 'Percakapan WhatsApp aktif. Pesan terakhir tamu: ' || LEFT(v_last_inbound, 220)),
    chat_summary_json = jsonb_build_object(
      'source', 'auto_seed',
      'short_summary', 'Percakapan WhatsApp aktif. Pesan terakhir tamu: ' || LEFT(v_last_inbound, 220),
      'guest_name', NULL,
      'last_topic', 'general',
      'room_type', NULL,
      'check_in', NULL,
      'check_out', NULL,
      'guest_count', NULL,
      'booking_status', NULL,
      'payment_status', NULL,
      'complaint_active', false,
      'unresolved_question', CASE WHEN v_last_inbound LIKE '%?%' THEN v_last_inbound ELSE NULL END,
      'needs_human', false,
      'handoff_reason', NULL
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