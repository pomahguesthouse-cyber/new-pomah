-- Branding assets for the property: guesthouse logo, invoice logo, favicon.
alter table public.properties
  add column if not exists logo_url text,
  add column if not exists invoice_logo_url text,
  add column if not exists favicon_url text;

notify pgrst, 'reload schema';
