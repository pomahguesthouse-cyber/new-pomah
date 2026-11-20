DROP POLICY IF EXISTS "anyone read channel status" ON public.channel_status;
CREATE POLICY "staff read channel status" ON public.channel_status FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "anyone read seasonal_rates" ON public.seasonal_rates;
CREATE POLICY "staff read seasonal_rates" ON public.seasonal_rates FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "public read room_daily_rates" ON public.room_daily_rates;
CREATE POLICY "public read current room_daily_rates" ON public.room_daily_rates FOR SELECT TO anon, authenticated USING (date >= (current_date - 1));

DROP POLICY IF EXISTS "Public can read landing slug redirects" ON public.seo_slug_redirects;
CREATE POLICY "Public can read valid landing slug redirects" ON public.seo_slug_redirects FOR SELECT TO anon, authenticated USING (to_slug IS NOT NULL AND from_slug IS DISTINCT FROM to_slug);