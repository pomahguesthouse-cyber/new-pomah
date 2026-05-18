-- Google Places API key, used server-side by the homepage Google
-- reviews widget. Edited from Settings → Integrasi.
alter table public.properties
  add column if not exists google_places_api_key text;

notify pgrst, 'reload schema';
