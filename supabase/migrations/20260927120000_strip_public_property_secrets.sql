-- Stop the public property payload from including credentials.
--
-- Live pages were serializing properties via get_public_property()
-- (to_jsonb of the whole row minus a short denylist) and, on room pages,
-- a service-role select(*). explore_config.gemini_api_key was returned
-- next to nearby_distance. The same payload also included
-- serper_api_key, tavily_api_key, telegram_bot_token, and
-- telegram_webhook_secret. Room pages additionally returned wpp_token,
-- payment account fields, ai_lab_config, smart_delay_config, and
-- competitor_hotels.
--
-- Anon has no SELECT policy on public.properties (admin read/write only).
-- There is no public view of the table. The leak is this SECURITY DEFINER
-- function, which bypasses RLS, plus get_google_reviews_config(), which
-- returned google_places_api_key to anon.
--
-- Idempotent. Does not drop columns or change stored data.
-- Lovable deploy does not run migrations — apply this file manually in
-- the Supabase SQL editor after the app deploy.
--
-- Keep the key regex aligned with SECRET_KEY_RE in
-- src/public/lib/public-settings.ts.

CREATE OR REPLACE FUNCTION public.strip_secret_json_keys(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(input) = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(t.key, public.strip_secret_json_keys(t.value)),
      '{}'::jsonb
    )
      INTO result
    FROM jsonb_each(input) AS t(key, value)
    WHERE t.key !~* '(^|_)(api[_-]?key|client[_-]?secret|secret|password|passwd|credential|service[_-]?role|webhook|payment_account|payment_bank)($|_)|_token$|^token$';
    RETURN result;
  END IF;

  IF jsonb_typeof(input) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(public.strip_secret_json_keys(elem)),
      '[]'::jsonb
    )
      INTO result
    FROM jsonb_array_elements(input) AS elem;
    RETURN result;
  END IF;

  RETURN input;
END;
$$;

REVOKE ALL ON FUNCTION public.strip_secret_json_keys(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.strip_secret_json_keys(jsonb) TO postgres, service_role;

-- Explicit public allowlist. Replaces to_jsonb(p) minus a denylist.
CREATE OR REPLACE FUNCTION public.get_public_property()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'tagline', p.tagline,
    'description', p.description,
    'address', p.address,
    'city', p.city,
    'country', p.country,
    'email', p.email,
    'phone', p.phone,
    'whatsapp_number', p.whatsapp_number,
    'hero_image_url', p.hero_image_url,
    'logo_url', p.logo_url,
    'invoice_logo_url', p.invoice_logo_url,
    'favicon_url', p.favicon_url,
    'public_domain', p.public_domain,
    'google_analytics_id', p.google_analytics_id,
    'google_tag_manager_id', p.google_tag_manager_id,
    'google_search_console', p.google_search_console,
    'google_place_id', p.google_place_id,
    'hotel_policy', p.hotel_policy,
    'homepage_config', public.strip_secret_json_keys(p.homepage_config::jsonb),
    'explore_config', public.strip_secret_json_keys(p.explore_config::jsonb),
    'currency', p.currency,
    'timezone', p.timezone,
    'instagram_url', p.instagram_url,
    'tiktok_url', p.tiktok_url,
    'youtube_url', p.youtube_url,
    'facebook_url', p.facebook_url,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

-- Keep the signature so existing callers do not break, but never return
-- the Places API key. The app reads that column with the service role.
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
SET search_path TO 'public'
AS $$
  SELECT
    p.google_place_id,
    NULL::text,
    p.custom_google_rating,
    p.custom_google_reviews_total,
    p.custom_google_reviews_json
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

-- Column grants: anon cannot read secret columns even if a future RLS
-- policy allows the row. Authenticated admins and service_role keep access
-- so the settings UI and server functions still work.
DO $$
DECLARE
  col text;
  secret_cols text[] := ARRAY[
    'gemini_api_key',
    'ai_api_key',
    'google_places_api_key',
    'serper_api_key',
    'tavily_api_key',
    'telegram_bot_token',
    'telegram_webhook_secret',
    'wpp_token'
  ];
BEGIN
  FOREACH col IN ARRAY secret_cols LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'properties'
        AND column_name = col
    ) THEN
      EXECUTE format(
        'REVOKE SELECT (%I) ON TABLE public.properties FROM PUBLIC, anon',
        col
      );
    END IF;
  END LOOP;
END $$;
