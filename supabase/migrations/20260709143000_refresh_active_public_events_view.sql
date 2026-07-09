-- Keep City Guide event reads compatible with current UI.
--
-- Problem:
-- Some deployments still have an old active_public_events view that does not
-- expose event_date_label. The app selects event_date_label, so the SELECT can
-- fail and newly-created manual events appear to be missing.
--
-- This migration recreates the public view with all fields needed by both
-- Admin City Guide and /explore.

ALTER TABLE public.seo_generated_articles
  ADD COLUMN IF NOT EXISTS event_start_date DATE,
  ADD COLUMN IF NOT EXISTS event_location TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS event_date_label TEXT;

DROP VIEW IF EXISTS public.active_public_events;

CREATE VIEW public.active_public_events AS
SELECT
  id,
  title,
  topic,
  meta_description AS description,
  event_start_date,
  event_end_date,
  event_date_label,
  event_location,
  image_url,
  tags,
  sources,
  created_at
FROM public.seo_generated_articles
WHERE category = 'event'
  AND status = 'active'
  AND (event_end_date IS NULL OR event_end_date >= CURRENT_DATE)
ORDER BY
  COALESCE(event_start_date, event_end_date, created_at::date) ASC;

GRANT SELECT ON public.active_public_events TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
