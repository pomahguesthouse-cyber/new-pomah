-- Public/direct bookings must never be confirmed into booking_rooms without a
-- physical room assignment.
--
-- The existing booking_rooms_no_overlap exclusion constraint prevents two active
-- bookings from sharing the same physical room over overlapping dates. This
-- guard closes the remaining gap: public booking code could insert NULL room_id
-- rows when no room was available, creating a pending booking that looked valid
-- but had no actual inventory behind it.

CREATE OR REPLACE FUNCTION public.reject_unassigned_direct_booking_room()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_source text;
  parent_status text;
BEGIN
  IF NEW.room_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT source::text, status::text
  INTO parent_source, parent_status
  FROM public.bookings
  WHERE id = NEW.booking_id;

  IF parent_source = 'direct'
     AND parent_status IN ('pending', 'confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'ROOM_UNAVAILABLE: Tidak ada kamar fisik kosong untuk tipe kamar dan tanggal tersebut.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Admin/manual flows may intentionally leave room_id empty for later assignment.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_rooms_reject_unassigned_direct ON public.booking_rooms;
CREATE TRIGGER booking_rooms_reject_unassigned_direct
  BEFORE INSERT ON public.booking_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_unassigned_direct_booking_room();

NOTIFY pgrst, 'reload schema';
