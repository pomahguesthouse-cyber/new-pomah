-- 1) Aktifkan RLS + kebijakan khusus staf untuk tabel yang sebelumnya tanpa proteksi.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'guest_structured_memory',
    'room_blocks',
    'user_modes',
    'wa_correction_dataset',
    'wa_correction_sessions',
    'wa_identity_aliases',
    'wa_training_ignored_threads',
    'wa_wpp_sync_state'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff manage ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))',
      'staff manage ' || t, t
    );
  END LOOP;
END $$;

-- 2) Konten walkthrough: batasi tulis ke staf saja (sebelumnya semua akun terautentikasi).
DROP POLICY IF EXISTS "walkthrough_tours staff all" ON public.walkthrough_tours;
CREATE POLICY "walkthrough_tours staff all" ON public.walkthrough_tours
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "walkthrough_scenes staff all" ON public.walkthrough_scenes;
CREATE POLICY "walkthrough_scenes staff all" ON public.walkthrough_scenes
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "walkthrough_hotspots staff all" ON public.walkthrough_hotspots;
CREATE POLICY "walkthrough_hotspots staff all" ON public.walkthrough_hotspots
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- 3) View acara publik: pakai izin pemanggil, bukan pembuat view.
ALTER VIEW public.active_public_events SET (security_invoker = on);

-- Agar fallback publik tetap berfungsi: hanya artikel kategori "event" berstatus aktif.
DROP POLICY IF EXISTS "public read active event articles" ON public.seo_generated_articles;
CREATE POLICY "public read active event articles" ON public.seo_generated_articles
  FOR SELECT TO anon, authenticated
  USING (category = 'event' AND status = 'active');

GRANT SELECT ON public.seo_generated_articles TO anon, authenticated;
GRANT SELECT ON public.active_public_events TO anon, authenticated;
GRANT ALL ON public.seo_generated_articles TO service_role;