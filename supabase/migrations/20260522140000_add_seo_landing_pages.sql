-- SEO Landing Pages — manually-crafted, keyword-targeted pages managed
-- from the AI SEO Control Room.  Separate from programmatic_seo_pages
-- (which are auto-generated from keyword templates).

create table if not exists seo_landing_pages (
  id               uuid        primary key default gen_random_uuid(),
  property_id      uuid        references properties(id) on delete cascade,
  -- Page identity
  title            text        not null,
  slug             text        not null,
  target_keyword   text,
  -- Hero section
  hero_headline    text,
  hero_subheadline text,
  hero_cta_text    text        not null default 'Pesan Sekarang',
  hero_cta_url     text        not null default '/book',
  -- Body
  body_content     text,
  -- SEO metadata
  meta_title       text,
  meta_description text,
  og_image_url     text,
  -- Status
  published        boolean     not null default false,
  -- Timestamps
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint seo_landing_pages_slug_key unique (slug)
);

-- Auto-update updated_at on any row change
create or replace function update_seo_landing_page_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_seo_landing_pages_updated_at
  before update on seo_landing_pages
  for each row execute function update_seo_landing_page_updated_at();
