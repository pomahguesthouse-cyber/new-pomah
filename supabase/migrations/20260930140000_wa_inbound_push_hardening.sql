-- Guest WhatsApp phone push: close the gaps left by 20260930130100.
-- Idempotent; safe to re-run. Apply AFTER 20260930130000 and 20260930130100.
--
-- What changes (push infra itself is untouched: enqueue_staff_push,
-- list_staff_push_tokens, send-staff-push, device_tokens are reused):
--   1. Preview is trimmed to ~100 characters (was 140).
--   2. Media without text shows a label: [Foto] [Dokumen] [Video] [Audio]
--      [Stiker] [Lokasi] [Kontak] [Lampiran]. The inbound RPC writes the row
--      BEFORE metadata.media_type is saved, so the label is derived from the
--      placeholder body ("[Lampiran document]", "[Lampiran imageMessage]",
--      the payment-proof placeholder) and from metadata when it is present.
--   3. Extra rows never push: any source that looks like sync/history/
--      backfill/mirror/import (prod uses 'wppconnect_sync'), simulator rows
--      (wpp_id 'sim-...') and the synthetic booking-form marker.
--   4. Per-message idempotency: one push per provider message id
--      (external_message_id / wpp_id), independent of the 30 s throttle, so a
--      duplicate delivered after the throttle window (or re-inserted after a
--      delete) cannot push twice.
-- Does not change booking totals, availability, or WhatsApp auto-reply.

CREATE TABLE IF NOT EXISTS public.staff_push_throttle (
  thread_id uuid PRIMARY KEY REFERENCES public.whatsapp_threads(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_push_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_push_throttle FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.staff_push_seen (
  dedupe_key text PRIMARY KEY,
  thread_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_push_seen_created_at_idx
  ON public.staff_push_seen (created_at);

ALTER TABLE public.staff_push_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_push_seen FROM PUBLIC, anon, authenticated;

-- Maps a media hint (Meta type, Evolution messageType, or mime type) to a label.
CREATE OR REPLACE FUNCTION public.wa_push_media_label(p_hint text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN h ~ 'sticker' THEN '[Stiker]'
    WHEN h ~ 'location' THEN '[Lokasi]'
    WHEN h ~ 'contact' THEN '[Kontak]'
    WHEN h ~ '(image|photo|foto|jpe?g|png|gif|webp)' THEN '[Foto]'
    WHEN h ~ '(video|mp4|3gpp?|ptv)' THEN '[Video]'
    WHEN h ~ '(audio|ptt|voice|ogg|opus|mpeg|mp3|m4a)' THEN '[Audio]'
    WHEN h ~ '(document|pdf|application|msword|spreadsheet|presentation|sheet|docx?|xlsx?|zip|file)' THEN '[Dokumen]'
    ELSE '[Lampiran]'
  END
  FROM (SELECT lower(coalesce(p_hint, '')) AS h) s
$$;

-- Push preview: real text trimmed to 100 characters, or a media label.
CREATE OR REPLACE FUNCTION public.wa_push_preview(p_body text, p_metadata jsonb DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  v_hint text;
BEGIN
  BEGIN
    v_hint := NULLIF(p_metadata ->> 'media_type', '');
  EXCEPTION WHEN OTHERS THEN
    v_hint := NULL;
  END;

  IF v = '' THEN
    IF v_hint IS NOT NULL THEN
      RETURN public.wa_push_media_label(v_hint);
    END IF;
    RETURN '[Pesan]';
  END IF;

  -- Placeholders written by the Meta and Evolution inbound handlers.
  IF v ~* '^\[lampiran [^\]]*\]$' THEN
    RETURN public.wa_push_media_label(substring(v from '^\[[Ll]ampiran ([^\]]*)\]$'));
  END IF;
  IF v ~* '^\[tamu mengirim lampiran bukti transfer pembayaran\]$' THEN
    RETURN '[Foto]';
  END IF;

  IF char_length(v) > 100 THEN
    RETURN left(v, 99) || '…';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_push_media_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_push_preview(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_staff_push_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_phone text;
  v_key text;
  v_first boolean;
  v_allowed boolean;
BEGIN
  -- Only genuine inbound guest messages. from_me is NULL on RPC-inserted
  -- inbound rows, so NULL counts as "not from me"; true is skipped.
  IF NEW.direction IS DISTINCT FROM 'in' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.from_me, false) OR COALESCE(NEW.ai_draft, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF lower(COALESCE(NEW.source, 'webhook')) ~ '(sync|history|backfill|mirror|import)' THEN
    RETURN NEW;
  END IF;
  -- Synthetic inbound rows: AI-lab simulator and the booking-form marker.
  IF COALESCE(NEW.wpp_id, '') LIKE 'sim-%' THEN
    RETURN NEW;
  END IF;
  IF btrim(COALESCE(NEW.body, '')) LIKE '[FORM\_SUBMITTED:%' THEN
    RETURN NEW;
  END IF;
  IF NEW.sent_at IS NOT NULL AND NEW.sent_at < now() - interval '30 minutes' THEN
    RETURN NEW;
  END IF;

  -- One push per provider message id, before the throttle so a duplicate
  -- never consumes the thread's 30 s window.
  v_key := COALESCE(NULLIF(btrim(NEW.external_message_id), ''), NULLIF(btrim(NEW.wpp_id), ''));
  IF v_key IS NOT NULL THEN
    WITH seen AS (
      INSERT INTO public.staff_push_seen (dedupe_key, thread_id)
      VALUES ('wa:' || v_key, NEW.thread_id)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING dedupe_key
    )
    SELECT EXISTS (SELECT 1 FROM seen) INTO v_first;

    IF NOT v_first THEN
      RETURN NEW;
    END IF;

    IF random() < 0.01 THEN
      DELETE FROM public.staff_push_seen WHERE created_at < now() - interval '14 days';
    END IF;
  END IF;

  -- At most one push per thread per 30 seconds; the first message always passes.
  WITH claim AS (
    INSERT INTO public.staff_push_throttle (thread_id, last_sent_at)
    VALUES (NEW.thread_id, now())
    ON CONFLICT (thread_id) DO UPDATE
      SET last_sent_at = EXCLUDED.last_sent_at
      WHERE public.staff_push_throttle.last_sent_at <= now() - interval '30 seconds'
    RETURNING thread_id
  )
  SELECT EXISTS (SELECT 1 FROM claim) INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN NEW;
  END IF;

  SELECT display_name, phone INTO v_name, v_phone
  FROM public.whatsapp_threads
  WHERE id = NEW.thread_id;

  PERFORM public.enqueue_staff_push(jsonb_build_object(
    'kind', 'whatsapp',
    'title', 'Pesan WhatsApp baru',
    'body', left(COALESCE(NULLIF(btrim(v_name), ''), NULLIF(btrim(v_phone), ''), 'Tamu'), 60)
            || ': ' || public.wa_push_preview(NEW.body, NEW.metadata),
    'url', '/admin/whatsapp?thread=' || NEW.thread_id::text,
    'thread_id', NEW.thread_id::text,
    'message_id', NEW.id::text
  ));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_staff_push_whatsapp skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_staff_push_whatsapp() FROM PUBLIC, anon, authenticated;

-- Same trigger definition as before; re-created so this file is self-contained.
DROP TRIGGER IF EXISTS trg_staff_push_whatsapp_inbound ON public.whatsapp_messages;
CREATE TRIGGER trg_staff_push_whatsapp_inbound
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_staff_push_whatsapp();

NOTIFY pgrst, 'reload schema';
