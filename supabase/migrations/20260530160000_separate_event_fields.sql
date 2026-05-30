-- ============================================================
-- Separate event-specific fields on seo_generated_articles
-- ============================================================
--
-- For category='event' we need richer structured fields than the
-- general "paragraphs" body so the rows can drive the public city
-- guide event slider directly:
--   - event_start_date  (first day of event, used to sort upcoming)
--   - event_location    (venue / address)
--   - image_url         (header image, best-effort from search)
--
-- event_end_date already exists. Articles in category='pariwisata'
-- or 'destinasi' simply leave these new fields NULL.
--
-- Adds a helper view active_public_events used by the public site
-- to fetch upcoming non-expired events without exposing the whole
-- generated-article table.
-- ============================================================

ALTER TABLE public.seo_generated_articles
  ADD COLUMN IF NOT EXISTS event_start_date DATE,
  ADD COLUMN IF NOT EXISTS event_location   TEXT,
  ADD COLUMN IF NOT EXISTS image_url        TEXT;

CREATE INDEX IF NOT EXISTS seo_generated_articles_event_dates_idx
  ON public.seo_generated_articles (event_start_date, event_end_date)
  WHERE category = 'event' AND status = 'active';

-- Public view for the city-guide slider — read-only, anon-accessible.
CREATE OR REPLACE VIEW public.active_public_events AS
SELECT
  id,
  title,
  topic,
  meta_description AS description,
  event_start_date,
  event_end_date,
  event_location,
  image_url,
  tags,
  sources,
  created_at
FROM public.seo_generated_articles
WHERE category = 'event'
  AND status   = 'active'
  AND (event_end_date IS NULL OR event_end_date >= CURRENT_DATE)
ORDER BY
  COALESCE(event_start_date, event_end_date, created_at::date) ASC;

GRANT SELECT ON public.active_public_events TO anon, authenticated, service_role;
