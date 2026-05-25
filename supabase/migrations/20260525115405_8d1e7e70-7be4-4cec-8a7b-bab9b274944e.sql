
CREATE OR REPLACE FUNCTION public.get_google_reviews_config()
RETURNS TABLE(google_place_id text, google_places_api_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.google_place_id, p.google_places_api_key
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_google_reviews_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_google_reviews_config() TO anon, authenticated;
