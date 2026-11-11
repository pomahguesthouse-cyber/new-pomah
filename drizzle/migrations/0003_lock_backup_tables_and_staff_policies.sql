DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_bak_bayartempat_20261031_training','_bak_azairul_20261016_booking_rooms','_bak_azairul_20261016_wa_booking_states','_bak_qaharga_20261020','_bak_qaharga_20261020_chunks','_bak_sopdapur_20261020_sop_documents','_bak_lunas_20261016_sop_documents','_bak_lunas_20261016_sop_chunks','_bak_seo_20261019_seo_landing_pages','_bak_lunas_20261016_training','_bak_facility_kb_20261020b','_bak_seo_20261019_properties','_bak_bayartempat_20261031_sop_chunks','_bak_persona_20261019_properties','_bak_facility_kb_20261020','_bak_sopdapur_20261020_training','_bak_sopdapur_20261020_sop_chunks','_bak_azairul_20261016_bookings','_bak_frome_20261019_whatsapp_messages','_bak_bayartempat_20261031_sop_documents','_bak_seo_20261019_room_types','_bak_frome_20261019_whatsapp_threads']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated staff can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated staff can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated staff can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated staff can delete expenses" ON public.expenses;
CREATE POLICY "Staff can read expenses" ON public.expenses FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can insert expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can update expenses" ON public.expenses FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can delete expenses" ON public.expenses FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Select rules" ON public.ai_intent_rules;

DROP POLICY IF EXISTS "walkthrough-360 staff update" ON storage.objects;
DROP POLICY IF EXISTS "walkthrough-360 staff delete" ON storage.objects;
DROP POLICY IF EXISTS "walkthrough-360 staff insert" ON storage.objects;
CREATE POLICY "walkthrough-360 staff insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'walkthrough-360' AND public.is_staff(auth.uid()));
CREATE POLICY "walkthrough-360 staff update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'walkthrough-360' AND public.is_staff(auth.uid())) WITH CHECK (bucket_id = 'walkthrough-360' AND public.is_staff(auth.uid()));
CREATE POLICY "walkthrough-360 staff delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'walkthrough-360' AND public.is_staff(auth.uid()));