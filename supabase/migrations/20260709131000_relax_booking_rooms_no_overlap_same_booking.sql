-- Fix admin Edit Booking false-positive overlap errors.
--
-- Context:
-- The admin edit flow replaces booking_rooms for the SAME booking. The old
-- exclusion constraint compared only room_id + date range, so stale rows from
-- the same booking could block saving with:
--   conflicting key value violates exclusion constraint "booking_rooms_no_overlap"
-- even when the calendar looked empty for other bookings.
--
-- Correct rule:
-- A physical room must not overlap with a DIFFERENT active booking.
-- Rows that belong to the same booking are part of the same reservation and
-- should not trigger this DB-level conflict while the app replaces room rows.
-- Also, checked_out/cancelled reservations should not block future edits.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.booking_rooms
  DROP CONSTRAINT IF EXISTS booking_rooms_no_overlap;

ALTER TABLE public.booking_rooms
  ADD CONSTRAINT booking_rooms_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    booking_id WITH <>,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (
    room_id IS NOT NULL
    AND booking_id IS NOT NULL
    AND check_in IS NOT NULL
    AND check_out IS NOT NULL
    AND booking_status IN ('pending', 'confirmed', 'checked_in')
  );

NOTIFY pgrst, 'reload schema';
