-- Priority 3.1: keep booking totals/invoices aligned with extra-bed policy.
--
-- The WhatsApp booking state machine can now compute extra bed from
-- room_types.capacity, room_types.extrabed_capacity, and room_types.extrabed_rate.
-- This migration adds a DB-side safety net so booking.total_amount is recomputed
-- from booking_rooms + the same room_types policy after room allocation lands.
--
-- Why DB-side?
-- - create_booking inserts bookings first, then booking_rooms.
-- - invoice generation reads bookings.total_amount.
-- - This trigger makes the persisted total correct even if a caller forgets to
--   include extra-bed fields in tool args.
--
-- Notes:
-- - No hardcoded room names.
-- - No hardcoded Rp80.000 fallback.
-- - If a room type has no extrabed_rate or extrabed_capacity, it simply does not
--   contribute extra-bed charge.
-- - For mixed room-type bookings, extra beds are allocated to room types with
--   available extra-bed capacity, starting from the lowest configured rate to
--   avoid overcharging the guest. Most WA bookings are single-type, where this
--   exactly matches the state-machine summary.

CREATE OR REPLACE FUNCTION public.recompute_booking_total_with_extrabed(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_room_total numeric := 0;
  v_extra_total numeric := 0;
  v_default_capacity int := 0;
  v_remaining_extra_beds int := 0;
  v_take int := 0;
  r record;
BEGIN
  SELECT id, nights, adults, status
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Cancelled bookings should not be financially recomputed by this helper.
  IF v_booking.status::text = 'cancelled' THEN
    RETURN;
  END IF;

  -- Room subtotal uses booking_rooms.nightly_rate, which the application already
  -- stamps with the resolved average dynamic rate for the stay.
  SELECT COALESCE(SUM(COALESCE(br.nightly_rate, 0) * GREATEST(COALESCE(v_booking.nights, 1), 1)), 0)
  INTO v_room_total
  FROM public.booking_rooms br
  WHERE br.booking_id = p_booking_id;

  -- Default capacity is the sum of room_types.capacity per allocated room.
  SELECT COALESCE(SUM(GREATEST(COALESCE(rt.capacity, 1), 1)), 0)
  INTO v_default_capacity
  FROM public.booking_rooms br
  LEFT JOIN public.room_types rt ON rt.id = br.room_type_id
  WHERE br.booking_id = p_booking_id;

  v_remaining_extra_beds := GREATEST(COALESCE(v_booking.adults, 1) - v_default_capacity, 0);

  IF v_remaining_extra_beds > 0 THEN
    FOR r IN
      SELECT
        br.room_type_id,
        COUNT(*)::int AS room_count,
        GREATEST(COALESCE(MAX(rt.extrabed_capacity), 0), 0)::int AS extrabed_capacity,
        GREATEST(COALESCE(MAX(rt.extrabed_rate), 0), 0)::numeric AS extrabed_rate
      FROM public.booking_rooms br
      LEFT JOIN public.room_types rt ON rt.id = br.room_type_id
      WHERE br.booking_id = p_booking_id
      GROUP BY br.room_type_id
      HAVING GREATEST(COALESCE(MAX(rt.extrabed_capacity), 0), 0) > 0
         AND GREATEST(COALESCE(MAX(rt.extrabed_rate), 0), 0) > 0
      ORDER BY GREATEST(COALESCE(MAX(rt.extrabed_rate), 0), 0) ASC
    LOOP
      EXIT WHEN v_remaining_extra_beds <= 0;

      v_take := LEAST(v_remaining_extra_beds, r.room_count * r.extrabed_capacity);
      IF v_take > 0 THEN
        v_extra_total := v_extra_total + (v_take * r.extrabed_rate * GREATEST(COALESCE(v_booking.nights, 1), 1));
        v_remaining_extra_beds := v_remaining_extra_beds - v_take;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.bookings
  SET total_amount = v_room_total + v_extra_total
  WHERE id = p_booking_id
    AND total_amount IS DISTINCT FROM (v_room_total + v_extra_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_booking_total_with_extrabed_from_booking_rooms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);
  IF v_booking_id IS NOT NULL THEN
    PERFORM public.recompute_booking_total_with_extrabed(v_booking_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_booking_total_with_extrabed_from_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_booking_total_with_extrabed(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_rooms_recompute_total_extrabed ON public.booking_rooms;
CREATE TRIGGER booking_rooms_recompute_total_extrabed
  AFTER INSERT OR UPDATE OF booking_id, room_type_id, nightly_rate OR DELETE ON public.booking_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_booking_total_with_extrabed_from_booking_rooms();

DROP TRIGGER IF EXISTS bookings_recompute_total_extrabed ON public.bookings;
CREATE TRIGGER bookings_recompute_total_extrabed
  AFTER UPDATE OF adults, nights, status ON public.bookings
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION public.recompute_booking_total_with_extrabed_from_bookings();

-- Backfill existing active bookings so reports/invoices align after deploy.
DO $$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT id FROM public.bookings
    WHERE status::text <> 'cancelled'
  LOOP
    PERFORM public.recompute_booking_total_with_extrabed(b.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
