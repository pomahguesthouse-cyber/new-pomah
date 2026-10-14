-- Ulasan tamu: tanggal cek angka Google + badge rating situs lain.
-- Daftar ulasan (custom_google_reviews_json) kini boleh berisi field
-- source ("google" | "booking" | "tripcom") dan date ("YYYY-MM[-DD]") per item.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS custom_google_reviews_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_source_badges jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.properties.custom_google_reviews_checked_at IS
  'Kapan rating & jumlah ulasan Google terakhir dicek manual.';
COMMENT ON COLUMN public.properties.review_source_badges IS
  'Badge situs lain: [{source, score, scale, count, url}]. Tidak masuk JSON-LD.';

-- Tipe hasil berubah → DROP lalu CREATE. Kunci API tetap tidak pernah dibuka.
DROP FUNCTION IF EXISTS public.get_google_reviews_config();
CREATE FUNCTION public.get_google_reviews_config()
RETURNS TABLE(
  google_place_id text,
  google_places_api_key text,
  custom_google_rating numeric,
  custom_google_reviews_total integer,
  custom_google_reviews_json jsonb,
  custom_google_reviews_checked_at timestamptz,
  review_source_badges jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.google_place_id, NULL::text, p.custom_google_rating, p.custom_google_reviews_total,
         p.custom_google_reviews_json, p.custom_google_reviews_checked_at, p.review_source_badges
  FROM public.properties p ORDER BY p.created_at ASC LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_google_reviews_config() TO anon, authenticated, service_role;
