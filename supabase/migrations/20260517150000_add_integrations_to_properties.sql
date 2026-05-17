-- Third-party integration settings for the property:
-- Fonnte WhatsApp token + Google Place / Analytics / Tag Manager /
-- Search Console identifiers.
alter table public.properties
  add column if not exists fonnte_token text,
  add column if not exists google_place_id text,
  add column if not exists google_analytics_id text,
  add column if not exists google_tag_manager_id text,
  add column if not exists google_search_console text;

notify pgrst, 'reload schema';
