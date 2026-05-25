
DROP POLICY IF EXISTS "Public can view published landing pages" ON public.seo_landing_pages;
CREATE POLICY "Public can view published landing pages" ON public.seo_landing_pages
  FOR SELECT TO anon, authenticated USING (published = true);
