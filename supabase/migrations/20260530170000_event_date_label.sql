-- ============================================================
-- Free-text event date label
-- ============================================================
--
-- event_start_date / event_end_date are strict ISO dates and stay null
-- for recurring or fuzzy events ("Setiap Akhir Pekan", "Tiap Hari",
-- "Sepanjang Bulan November"). Add event_date_label so the AI can
-- record those descriptors verbatim, and the UI can show SOMETHING
-- in the date slot for every event.
-- ============================================================

ALTER TABLE public.seo_generated_articles
  ADD COLUMN IF NOT EXISTS event_date_label TEXT;

-- Refresh the public view so the new field is exposed too.
CREATE OR REPLACE VIEW public.active_public_events AS
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
  AND status   = 'active'
  AND (event_end_date IS NULL OR event_end_date >= CURRENT_DATE)
ORDER BY
  COALESCE(event_start_date, event_end_date, created_at::date) ASC;

GRANT SELECT ON public.active_public_events TO anon, authenticated, service_role;
