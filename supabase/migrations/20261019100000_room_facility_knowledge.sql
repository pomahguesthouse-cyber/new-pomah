-- Knowledge base fasilitas per kamar: sumber tunggal jawaban bot untuk
-- password WiFi (+ letaknya), dapur, alat masak, handuk, hairdryer, titik
-- check-in, link maps. room_type_id NULL = berlaku untuk semua kamar.
CREATE TABLE IF NOT EXISTS public.room_facility_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE,
  wifi_password text,
  wifi_password_location text,
  kitchen text,
  cooking_tools text,
  towels text,
  hairdryer text,
  checkin_point text,
  maps_url text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT room_facility_knowledge_room_type_key UNIQUE NULLS NOT DISTINCT (room_type_id)
);

ALTER TABLE public.room_facility_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read room facility knowledge" ON public.room_facility_knowledge;
CREATE POLICY "staff read room facility knowledge" ON public.room_facility_knowledge
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin write room facility knowledge" ON public.room_facility_knowledge;
CREATE POLICY "admin write room facility knowledge" ON public.room_facility_knowledge
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
