-- Landing-page technical SEO.
-- Lovable deploy does NOT run migrations. Apply this file manually after deploy.
-- Until it is applied, the app must keep working: noindex stays off and
-- renamed slugs simply 404 instead of 301.

alter table public.seo_landing_pages
  add column if not exists noindex boolean not null default false;

comment on column public.seo_landing_pages.noindex is
  'Published page stays reachable but is omitted from the sitemap and emits meta robots noindex.';

create table if not exists public.seo_slug_redirects (
  id uuid primary key default gen_random_uuid(),
  from_slug text not null,
  to_slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_slug_redirects_from_slug_key unique (from_slug),
  constraint seo_slug_redirects_no_self check (from_slug <> to_slug)
);

comment on table public.seo_slug_redirects is
  'Old /lp slug → current /lp slug. Application code collapses chains and refuses loops.';

alter table public.seo_slug_redirects enable row level security;

drop policy if exists "Public can read landing slug redirects" on public.seo_slug_redirects;
create policy "Public can read landing slug redirects"
  on public.seo_slug_redirects
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Staff manage landing slug redirects" on public.seo_slug_redirects;
create policy "Staff manage landing slug redirects"
  on public.seo_slug_redirects
  for all
  to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

grant select on table public.seo_slug_redirects to anon, authenticated;
grant insert, update, delete on table public.seo_slug_redirects to authenticated;
