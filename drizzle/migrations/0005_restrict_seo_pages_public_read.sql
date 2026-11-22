DROP POLICY IF EXISTS "anyone read seo_pages" ON public.seo_pages;
CREATE POLICY "public read valid seo_pages"
  ON public.seo_pages
  FOR SELECT
  TO anon, authenticated
  USING (length(trim(slug)) > 0 AND length(trim(title)) > 0);