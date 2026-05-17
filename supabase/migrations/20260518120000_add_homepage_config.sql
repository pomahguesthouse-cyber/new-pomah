-- Homepage Builder configuration: a single JSONB document holding the
-- header, hero slider, date-picker widget and room-carousel settings,
-- edited from the admin "Halaman Depan" page.
alter table public.properties
  add column if not exists homepage_config jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
