-- Keep booking totals derived from selected physical rooms, not from paid_amount.
--
-- Bug fixed:
-- In Admin Edit/New Booking, paid bookings could show/write total_amount equal
-- to the old paid_amount. Example: 1 Grand Deluxe x 2 nights should be
-- Rp600.000, but total_amount stayed Rp1.800.000 because payment_status='paid'.
--
-- Correct rule:
--   total_amount = sum(room nightly rate x nights + extra bed x nights)
--   paid_amount  = total_amount when payment_status='paid'
--   paid_amount  = 0 when payment_status='unpaid'
--   paid_amount  = min(existing paid_amount, total_amount) when partial

CREATE OR REPLACE FUNCTION public.recalculate_booking_total_from_rooms(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check_in date;
  v_check_out date;
  v_nights integer;
  v_payment_status text;
  v_paid_amount numeric;
  v_total numeric;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT b.check_in, b.check_out, b.payment_status::text, COALESCE(b.paid_amount, 0)
  INTO v_check_in, v_check_out, v_payment_status, v_paid_amount
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_nights := GREATEST(1, (v_check_out - v_check_in));

  SELECT COALESCE(
    SUM(
      COALESCE(br.nightly_rate, 0) * v_nights
      + COALESCE(br.extra_bed_rate, 0) * COALESCE(br.extra_bed_count, 0) * v_nights
    ),
    0
  )
  INTO v_total
  FROM public.booking_rooms br
  WHERE br.booking_id = p_booking_id;

  UPDATE public.bookings b
  SET
    total_amount = v_total,
    paid_amount = CASE
      WHEN v_payment_status = 'paid' THEN v_total
      WHEN v_payment_status = 'unpaid' THEN 0
      ELSE LEAST(GREATEST(v_paid_amount, 0), v_total)
    END,
    nights = v_nights,
    updated_at = now()
  WHERE b.id = p_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_rooms_recalculate_parent_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);
  PERFORM public.recalculate_booking_total_from_rooms(v_booking_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS booking_rooms_recalculate_total ON public.booking_rooms;
CREATE TRIGGER booking_rooms_recalculate_total
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.booking_rooms_recalculate_parent_total();

CREATE OR REPLACE FUNCTION public.bookings_recalculate_total_when_payment_or_dates_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Avoid recursion from recalculate_booking_total_from_rooms(), which updates
  -- total_amount/paid_amount/nights/updated_at only.
  IF NEW.check_in IS DISTINCT FROM OLD.check_in
     OR NEW.check_out IS DISTINCT FROM OLD.check_out
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.recalculate_booking_total_from_rooms(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_recalculate_total ON public.bookings;
CREATE TRIGGER bookings_recalculate_total
  AFTER UPDATE OF check_in, check_out, payment_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_recalculate_total_when_payment_or_dates_change();

-- Backfill existing rows once.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.bookings LOOP
    PERFORM public.recalculate_booking_total_from_rooms(r.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
