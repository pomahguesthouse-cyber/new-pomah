-- Add columns for custom/editable Google Rating & Reviews
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS custom_google_rating NUMERIC(3,2);
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS custom_google_reviews_total INTEGER;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS custom_google_reviews_json JSONB;

-- Recreate RPC function to return the new columns too
CREATE OR REPLACE FUNCTION public.get_google_reviews_config()
RETURNS TABLE(
  google_place_id text,
  google_places_api_key text,
  custom_google_rating numeric,
  custom_google_reviews_total integer,
  custom_google_reviews_json jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.google_place_id, 
    p.google_places_api_key,
    p.custom_google_rating,
    p.custom_google_reviews_total,
    p.custom_google_reviews_json
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;
