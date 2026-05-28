-- Create a secure RPC function to fetch a single booking's invoice details.
-- Since anonymous guests do not have SELECT permissions on the bookings table
-- due to RLS, and the service role key might not be provisioned in all
-- edge runtime environments, this SECURITY DEFINER function allows guests
-- to securely pull their own booking details if they hold the unguessable reference code.

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
  v_pdf_url text;
  v_is_uuid boolean;
  v_booking_uuid uuid;
BEGIN
  -- 1. Determine if p_id is a UUID or a reference code
  v_is_uuid := p_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  
  IF v_is_uuid THEN
    v_booking_uuid := p_id::uuid;
  ELSE
    SELECT id INTO v_booking_uuid FROM public.bookings WHERE reference_code ILIKE p_id LIMIT 1;
  END IF;

  IF v_booking_uuid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Get booking details
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking_uuid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 3. Get guest details
  SELECT * INTO v_guest FROM public.guests WHERE id = v_booking.guest_id;

  -- 4. Get property details (always 1 row)
  SELECT * INTO v_property FROM public.properties LIMIT 1;

  -- 5. Get rooms count & first room type details
  SELECT count(*)::int INTO v_rooms_count FROM public.booking_rooms WHERE booking_id = v_booking_uuid;
  SELECT nightly_rate INTO v_nightly_rate FROM public.booking_rooms WHERE booking_id = v_booking_uuid LIMIT 1;
  
  SELECT name INTO v_room_type_name FROM public.room_types WHERE id = (
    SELECT room_type_id FROM public.booking_rooms WHERE booking_id = v_booking_uuid LIMIT 1
  );

  -- 6. Get invoice PDF URL if exists
  SELECT pdf_url INTO v_pdf_url FROM public.invoices WHERE booking_id = v_booking_uuid LIMIT 1;

  -- 7. Build and return the JSON payload matching BookingInvoice type
  RETURN json_build_object(
    'reference_code', COALESCE(v_booking.reference_code, ''),
    'status', COALESCE(v_booking.status::text, 'pending'),
    'check_in', COALESCE(v_booking.check_in::text, ''),
    'check_out', COALESCE(v_booking.check_out::text, ''),
    'nights', COALESCE(v_booking.nights, 1),
    'adults', COALESCE(v_booking.adults, 0),
    'children', COALESCE(v_booking.children, 0),
    'rooms', COALESCE(v_rooms_count, 1),
    'room_type', COALESCE(v_room_type_name, 'Kamar'),
    'nightly_rate', COALESCE(v_nightly_rate, 0),
    'total_amount', COALESCE(v_booking.total_amount, 0),
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

-- Grant permissions to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION public.get_public_booking_invoice(text) TO anon, authenticated;
