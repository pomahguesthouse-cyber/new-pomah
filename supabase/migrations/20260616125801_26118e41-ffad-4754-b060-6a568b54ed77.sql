
-- 1. Remove anon INSERT on bookings; service-role server functions handle public booking creation
DROP POLICY IF EXISTS "anyone create pending booking" ON public.bookings;

-- 2. Remove anon INSERT on guests; service-role server functions handle guest creation
DROP POLICY IF EXISTS "anyone create guest" ON public.guests;

-- 3. Restrict properties write/read to admins only (table holds sensitive credentials)
DROP POLICY IF EXISTS "staff write properties" ON public.properties;
CREATE POLICY "admin write properties"
  ON public.properties
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
