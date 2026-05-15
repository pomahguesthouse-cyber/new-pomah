-- ============================================================
-- Visual Page Builder — schema foundation
-- ============================================================
-- The component tree of every page is stored as a versioned JSONB
-- document (content/published_content). This is the standard,
-- scalable approach used by Webflow / Wix — it avoids deep joins
-- and ordering bookkeeping that a per-row page_components table
-- would require, while still allowing relational version history,
-- design tokens, media, templates and reusable blocks.
-- ============================================================

-- ---------- landing_pages -----------------------------------
create table if not exists public.landing_pages (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  slug             text not null unique,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  -- working draft tree: { "version": 1, "nodes": [...] }
  content          jsonb not null default '{"version":1,"nodes":[]}'::jsonb,
  -- last published snapshot, served to the public
  published_content jsonb,
  -- SEO
  seo_title        text,
  seo_description  text,
  og_image_url     text,
  canonical_url    text,
  noindex          boolean not null default false,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);

alter table public.landing_pages enable row level security;

-- Anonymous visitors may only read PUBLISHED pages (public render route).
create policy "anon read published landing_pages"
  on public.landing_pages for select to anon
  using (status = 'published');

-- Staff have full access.
create policy "staff manage landing_pages"
  on public.landing_pages for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create trigger landing_pages_set_updated_at
  before update on public.landing_pages
  for each row execute function public.set_updated_at();

create index if not exists landing_pages_status_idx on public.landing_pages (status);

-- ---------- landing_page_versions ---------------------------
create table if not exists public.landing_page_versions (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.landing_pages(id) on delete cascade,
  version_number integer not null,
  content        jsonb not null,
  label          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (page_id, version_number)
);

alter table public.landing_page_versions enable row level security;

create policy "staff manage landing_page_versions"
  on public.landing_page_versions for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create index if not exists landing_page_versions_page_idx
  on public.landing_page_versions (page_id, version_number desc);

-- ---------- design_tokens -----------------------------------
-- Global design system: colors, typography scale, spacing scale.
create table if not exists public.design_tokens (
  id          uuid primary key default gen_random_uuid(),
  token_group text not null check (token_group in ('color', 'typography', 'spacing', 'radius', 'shadow')),
  name        text not null,
  value       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (token_group, name)
);

alter table public.design_tokens enable row level security;

create policy "anyone read design_tokens"
  on public.design_tokens for select to anon, authenticated using (true);

create policy "staff manage design_tokens"
  on public.design_tokens for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create trigger design_tokens_set_updated_at
  before update on public.design_tokens
  for each row execute function public.set_updated_at();

-- ---------- media_assets ------------------------------------
create table if not exists public.media_assets (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  url         text not null,
  mime_type   text,
  size_bytes  bigint,
  width       integer,
  height      integer,
  folder      text not null default 'uncategorized',
  alt_text    text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

alter table public.media_assets enable row level security;

create policy "anyone read media_assets"
  on public.media_assets for select to anon, authenticated using (true);

create policy "staff manage media_assets"
  on public.media_assets for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create index if not exists media_assets_folder_idx on public.media_assets (folder);

-- ---------- reusable_blocks ---------------------------------
-- A saved section the user can drop into any page.
create table if not exists public.reusable_blocks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'general',
  content       jsonb not null,
  thumbnail_url text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.reusable_blocks enable row level security;

create policy "anyone read reusable_blocks"
  on public.reusable_blocks for select to anon, authenticated using (true);

create policy "staff manage reusable_blocks"
  on public.reusable_blocks for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create trigger reusable_blocks_set_updated_at
  before update on public.reusable_blocks
  for each row execute function public.set_updated_at();

-- ---------- page_templates ----------------------------------
-- Ready-made full-page starting points (hotel / villa / promo / ...).
create table if not exists public.page_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'landing'
                  check (category in ('hotel', 'guesthouse', 'villa', 'restaurant', 'corporate', 'landing', 'promo')),
  description   text,
  content       jsonb not null,
  thumbnail_url text,
  is_builtin    boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.page_templates enable row level security;

create policy "anyone read page_templates"
  on public.page_templates for select to anon, authenticated using (true);

create policy "staff manage page_templates"
  on public.page_templates for all to authenticated
  using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

-- ---------- seed: starter design tokens ---------------------
insert into public.design_tokens (token_group, name, value, sort_order) values
  ('color', 'Primary',    '#b45309', 1),
  ('color', 'Ink',        '#1c1917', 2),
  ('color', 'Muted',      '#78716c', 3),
  ('color', 'Surface',    '#fafaf9', 4),
  ('color', 'White',      '#ffffff', 5),
  ('spacing', 'Tight',    '1rem',   1),
  ('spacing', 'Normal',   '2rem',   2),
  ('spacing', 'Loose',    '4rem',   3),
  ('radius', 'Small',     '0.5rem', 1),
  ('radius', 'Large',     '1rem',   2)
on conflict (token_group, name) do nothing;

notify pgrst, 'reload schema';
