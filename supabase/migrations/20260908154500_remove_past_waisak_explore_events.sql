-- Remove the two past Waisak City Guide events from properties.explore_config.
-- Those rows are stored in the JSON events array (Unsplash images) and still
-- render on /explore even though they are not in explore_items or admin PMS.
-- Destinations, culinary, news, rooms, and booking columns are left untouched.

UPDATE public.properties
SET explore_config = jsonb_set(
  explore_config,
  '{events}',
  COALESCE(
    (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(COALESCE(explore_config -> 'events', '[]'::jsonb)) AS elem
      WHERE coalesce(elem->>'title', '') NOT ILIKE '%Kirab Api Dharma Waisak ke Candi Borobudur%'
        AND coalesce(elem->>'title', '') NOT ILIKE '%Prosesi Pengambilan Api Dharma Waisak%'
        AND coalesce(elem->>'title', '') NOT ILIKE '%Api Abadi Mrapen%'
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(explore_config -> 'events') = 'array';

DELETE FROM public.explore_items
WHERE category IN ('event', 'events')
  AND (
    title ILIKE '%Kirab Api Dharma Waisak ke Candi Borobudur%'
    OR title ILIKE '%Prosesi Pengambilan Api Dharma Waisak%'
    OR title ILIKE '%Api Abadi Mrapen%'
  );

DELETE FROM public.seo_generated_articles
WHERE category = 'event'
  AND status IN ('active', 'expired')
  AND (
    title ILIKE '%Kirab Api Dharma Waisak ke Candi Borobudur%'
    OR title ILIKE '%Prosesi Pengambilan Api Dharma Waisak%'
    OR title ILIKE '%Api Abadi Mrapen%'
  );
