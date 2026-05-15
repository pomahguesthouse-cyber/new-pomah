-- Consolidate to a single domain: drop the unused admin_domain column.
-- The admin dashboard is now served from the /admin path on the public domain.
alter table public.properties
  drop column if exists admin_domain;
