-- Include per-room invoice details so multi-room bookings can show each
-- booked room, rate, and subtotal instead of only the first room rate.

CREATE OR REPLACE FUNCTION public.get_public_booking_invoice(p_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_guest record;
  v_property record;
  v_room_type_name text;
  v_nightly_rate numeric;
  v_rooms_count int;
  v_room_details json;
  v_pdf_url text;
  v_is_uuid boolean;
  v_booking_uuid uuid;
BEGIN
  v_is_uuid := p_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_is_uuid THEN
    v_booking_uuid := p_id::uuid;
  ELSE
    SELECT id INTO v_booking_uuid FROM public.bookings WHERE reference_code ILIKE p_id LIMIT 1;
  END IF;

  IF v_booking_uuid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking_uuid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_guest FROM public.guests WHERE id = v_booking.guest_id;
  SELECT * INTO v_property FROM public.properties LIMIT 1;

  SELECT
    COUNT(*)::int,
    COALESCE(
      json_agg(
        json_build_object(
          'id', br.id,
          'room_id', br.room_id,
          'room_number', r.number,
          'room_type_id', br.room_type_id,
          'room_type', COALESCE(rt.name, 'Kamar'),
          'nightly_rate', COALESCE(br.nightly_rate, 0)
        )
        ORDER BY br.created_at ASC, br.id ASC
      ),
      '[]'::json
    )
  INTO v_rooms_count, v_room_details
  FROM public.booking_rooms br
  LEFT JOIN public.room_types rt ON rt.id = br.room_type_id
  LEFT JOIN public.rooms r ON r.id = br.room_id
  WHERE br.booking_id = v_booking_uuid;

  SELECT nightly_rate INTO v_nightly_rate
  FROM public.booking_rooms
  WHERE booking_id = v_booking_uuid
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  SELECT string_agg(name, ', ' ORDER BY name)
  INTO v_room_type_name
  FROM (
    SELECT DISTINCT rt.name
    FROM public.booking_rooms br
    JOIN public.room_types rt ON rt.id = br.room_type_id
    WHERE br.booking_id = v_booking_uuid
  ) room_names;

  SELECT pdf_url INTO v_pdf_url FROM public.invoices WHERE booking_id = v_booking_uuid LIMIT 1;

  RETURN json_build_object(
    'reference_code', COALESCE(v_booking.reference_code, ''),
    'status', COALESCE(v_booking.status::text, 'pending'),
    'check_in', COALESCE(v_booking.check_in::text, ''),
    'check_out', COALESCE(v_booking.check_out::text, ''),
    'nights', COALESCE(v_booking.nights, 1),
    'adults', COALESCE(v_booking.adults, 0),
    'children', COALESCE(v_booking.children, 0),
    'rooms', GREATEST(COALESCE(v_rooms_count, 0), 1),
    'room_type', COALESCE(v_room_type_name, 'Kamar'),
    'nightly_rate', COALESCE(v_nightly_rate, 0),
    'room_details', COALESCE(v_room_details, '[]'::json),
    'total_amount', COALESCE(v_booking.total_amount, 0),
    'payment_status', COALESCE(v_booking.payment_status::text, 'unpaid'),
    'paid_amount', COALESCE(v_booking.paid_amount, 0),
    'payment_method', COALESCE(v_booking.payment_method, ''),
    'check_in_time', COALESCE(v_booking.check_in_time, ''),
    'check_out_time', COALESCE(v_booking.check_out_time, ''),
    'special_requests', COALESCE(v_booking.special_requests, ''),
    'created_at', COALESCE(v_booking.created_at::text, ''),
    'pdf_url', v_pdf_url,
    'guest', json_build_object(
      'full_name', COALESCE(v_guest.full_name, ''),
      'email', COALESCE(v_guest.email, ''),
      'phone', COALESCE(v_guest.phone, '')
    ),
    'property', json_build_object(
      'name', COALESCE(v_property.name, 'Pomah Guesthouse'),
      'address', COALESCE(v_property.address, ''),
      'bank', COALESCE(v_property.payment_bank_name, ''),
      'account_number', COALESCE(v_property.payment_account_number, ''),
      'account_holder', COALESCE(v_property.payment_account_holder, '')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_booking_invoice(text) TO anon, authenticated;
