-- Prevent double-booking a single physical room across overlapping date
-- ranges. Up to now we relied on a pre-write availability check + an
-- application-level race detection rollback in src/tools/booking.tool.ts —
-- both could lose a tight concurrent race. This migration installs a DB-
-- level exclusion constraint that makes the conflict impossible: the second
-- INSERT raises 23P01 (exclusion_violation) and the application rolls back.
--
-- Postgres EXCLUDE needs all conflict columns on the same row, but
-- booking_rooms historically only stored room_id — the dates live on the
-- parent bookings row. We denormalize check_in/check_out/booking_status
-- onto booking_rooms and keep them in sync with triggers.

-- Required: combine "=" (room_id) and "&&" (daterange) in one EXCLUDE.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 1. Denormalized columns ─────────────────────────────────────────────────
ALTER TABLE public.booking_rooms
  ADD COLUMN IF NOT EXISTS check_in       date,
  ADD COLUMN IF NOT EXISTS check_out      date,
  ADD COLUMN IF NOT EXISTS booking_status text;

-- ── 2. Backfill from existing parent bookings ───────────────────────────────
UPDATE public.booking_rooms br
SET check_in       = b.check_in,
    check_out      = b.check_out,
    booking_status = b.status::text
FROM public.bookings b
WHERE br.booking_id = b.id
  AND (br.check_in IS NULL
       OR br.check_out IS NULL
       OR br.booking_status IS NULL);

-- ── 3a. INSERT trigger — populate denormalized fields from parent ──────────
CREATE OR REPLACE FUNCTION public.populate_booking_rooms_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.check_in IS NULL
     OR NEW.check_out IS NULL
     OR NEW.booking_status IS NULL THEN
    SELECT b.check_in, b.check_out, b.status::text
    INTO   NEW.check_in, NEW.check_out, NEW.booking_status
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_rooms_populate ON public.booking_rooms;
CREATE TRIGGER booking_rooms_populate
  BEFORE INSERT ON public.booking_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_booking_rooms_from_parent();

-- ── 3b. UPDATE trigger — propagate parent date/status changes downward ─────
CREATE OR REPLACE FUNCTION public.sync_booking_rooms_from_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.check_in  IS DISTINCT FROM OLD.check_in
     OR NEW.check_out IS DISTINCT FROM OLD.check_out
     OR NEW.status    IS DISTINCT FROM OLD.status THEN
    UPDATE public.booking_rooms
    SET check_in       = NEW.check_in,
        check_out      = NEW.check_out,
        booking_status = NEW.status::text
    WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_booking_rooms ON public.bookings;
CREATE TRIGGER bookings_sync_booking_rooms
  AFTER UPDATE OF check_in, check_out, status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_rooms_from_booking();

-- ── 4. The exclusion constraint ─────────────────────────────────────────────
-- Half-open daterange [check_in, check_out): back-to-back stays (one books
-- through Jun 7, another starts Jun 7) are NOT a conflict. Cancelled bookings
-- are excluded from the constraint so cancelling frees the slot for another
-- booking. checked_out is allowed too but rarely matters thanks to the
-- half-open range.
ALTER TABLE public.booking_rooms
  DROP CONSTRAINT IF EXISTS booking_rooms_no_overlap;

ALTER TABLE public.booking_rooms
  ADD CONSTRAINT booking_rooms_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (
    room_id IS NOT NULL
    AND check_in IS NOT NULL
    AND check_out IS NOT NULL
    AND booking_status NOT IN ('cancelled')
  );

-- ── 5. Notify PostgREST so the new columns + constraint are picked up ───────
NOTIFY pgrst, 'reload schema';
