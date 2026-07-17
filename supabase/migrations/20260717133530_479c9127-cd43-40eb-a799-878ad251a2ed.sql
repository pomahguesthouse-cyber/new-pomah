
CREATE OR REPLACE FUNCTION public.normalize_phone_id(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE digits text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  digits := regexp_replace(p_raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;
  IF left(digits, 2) = '62' THEN RETURN digits;
  ELSIF left(digits, 1) = '0' THEN RETURN '62' || substr(digits, 2);
  ELSIF left(digits, 1) = '8' THEN RETURN '62' || digits;
  END IF;
  RETURN digits;
END;
$$;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS phone_normalized text,
  ADD COLUMN IF NOT EXISTS real_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS total_bookings integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.guests(id) ON DELETE SET NULL;

UPDATE public.guests SET phone_normalized = public.normalize_phone_id(phone)
  WHERE phone_normalized IS NULL AND phone IS NOT NULL;

WITH ranked AS (
  SELECT id, phone_normalized,
         ROW_NUMBER() OVER (PARTITION BY phone_normalized ORDER BY created_at ASC, id ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY phone_normalized ORDER BY created_at ASC, id ASC) AS canonical_id
  FROM public.guests
  WHERE phone_normalized IS NOT NULL AND merged_into IS NULL
), dupes AS (SELECT id, canonical_id FROM ranked WHERE rn > 1)
UPDATE public.guests g SET merged_into = d.canonical_id, updated_at = now()
FROM dupes d WHERE g.id = d.id;

UPDATE public.bookings b SET guest_id = g.merged_into
FROM public.guests g WHERE b.guest_id = g.id AND g.merged_into IS NOT NULL;

UPDATE public.whatsapp_threads t SET guest_id = g.merged_into
FROM public.guests g WHERE t.guest_id = g.id AND g.merged_into IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_guests_phone_normalized_active
  ON public.guests(phone_normalized)
  WHERE phone_normalized IS NOT NULL AND merged_into IS NULL;

CREATE INDEX IF NOT EXISTS idx_guests_last_seen ON public.guests(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_guests_source ON public.guests(source);
CREATE INDEX IF NOT EXISTS idx_guests_merged_into ON public.guests(merged_into);

CREATE OR REPLACE FUNCTION public.tg_guests_set_phone_normalized()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.phone_normalized := public.normalize_phone_id(NEW.phone);
  IF NEW.last_seen_at IS NULL THEN NEW.last_seen_at := now(); END IF;
  IF NEW.first_seen_at IS NULL THEN NEW.first_seen_at := now(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guests_phone_norm ON public.guests;
CREATE TRIGGER trg_guests_phone_norm
  BEFORE INSERT OR UPDATE OF phone ON public.guests
  FOR EACH ROW EXECUTE FUNCTION public.tg_guests_set_phone_normalized();

CREATE OR REPLACE FUNCTION public.tg_wa_thread_upsert_guest()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_normalized text; v_guest_id uuid; v_name text;
BEGIN
  v_normalized := public.normalize_phone_id(COALESCE(NEW.canonical_phone, NEW.phone));
  IF v_normalized IS NULL THEN RETURN NEW; END IF;
  v_name := NULLIF(btrim(COALESCE(NEW.display_name, '')), '');

  SELECT id INTO v_guest_id FROM public.guests
    WHERE phone_normalized = v_normalized AND merged_into IS NULL LIMIT 1;

  IF v_guest_id IS NULL THEN
    INSERT INTO public.guests(full_name, phone, phone_normalized, display_name, source, first_seen_at, last_seen_at)
    VALUES (COALESCE(v_name, v_normalized), COALESCE(NEW.phone, v_normalized), v_normalized, v_name, 'whatsapp', now(), now())
    RETURNING id INTO v_guest_id;
  ELSE
    UPDATE public.guests
      SET display_name = COALESCE(display_name, v_name),
          last_seen_at = now(), updated_at = now()
      WHERE id = v_guest_id;
  END IF;

  IF NEW.guest_id IS DISTINCT FROM v_guest_id THEN NEW.guest_id := v_guest_id; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_thread_upsert_guest ON public.whatsapp_threads;
CREATE TRIGGER trg_wa_thread_upsert_guest
  BEFORE INSERT OR UPDATE OF phone, canonical_phone, display_name ON public.whatsapp_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_wa_thread_upsert_guest();

CREATE OR REPLACE FUNCTION public.tg_booking_update_contact_stats()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.guest_id IS NOT NULL THEN
    UPDATE public.guests g
    SET total_bookings = (SELECT COUNT(*) FROM public.bookings b WHERE b.guest_id = g.id),
        total_spent    = COALESCE((SELECT SUM(b.total_amount) FROM public.bookings b WHERE b.guest_id = g.id AND b.status <> 'cancelled'), 0),
        last_seen_at   = GREATEST(COALESCE(last_seen_at, now()), now()),
        source         = CASE WHEN source IN ('whatsapp','manual') OR source IS NULL THEN 'booking' ELSE source END,
        updated_at     = now()
    WHERE g.id = NEW.guest_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_contact_stats ON public.bookings;
CREATE TRIGGER trg_booking_contact_stats
  AFTER INSERT OR UPDATE OF guest_id, total_amount, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_update_contact_stats();

-- Backfill: DISTINCT ON normalized phone so we insert once per number
INSERT INTO public.guests (full_name, phone, phone_normalized, display_name, source, first_seen_at, last_seen_at)
SELECT DISTINCT ON (public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone)))
  COALESCE(NULLIF(btrim(t.display_name),''), public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone))),
  COALESCE(t.phone, t.canonical_phone),
  public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone)),
  NULLIF(btrim(t.display_name),''),
  'whatsapp',
  COALESCE(t.created_at, now()),
  COALESCE(t.last_message_at, now())
FROM public.whatsapp_threads t
WHERE t.guest_id IS NULL
  AND public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone)) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.guests g
    WHERE g.phone_normalized = public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone))
      AND g.merged_into IS NULL
  )
ORDER BY public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone)), t.created_at ASC;

UPDATE public.whatsapp_threads t SET guest_id = g.id
FROM public.guests g
WHERE t.guest_id IS NULL AND g.merged_into IS NULL
  AND g.phone_normalized = public.normalize_phone_id(COALESCE(t.canonical_phone, t.phone));

UPDATE public.guests g
SET total_bookings = COALESCE(s.cnt, 0),
    total_spent    = COALESCE(s.total, 0),
    last_seen_at   = GREATEST(COALESCE(g.last_seen_at, g.created_at), COALESCE(s.last, g.created_at))
FROM (
  SELECT guest_id, COUNT(*) AS cnt, SUM(total_amount) FILTER (WHERE status <> 'cancelled') AS total, MAX(created_at) AS last
  FROM public.bookings WHERE guest_id IS NOT NULL GROUP BY guest_id
) s WHERE s.guest_id = g.id;
