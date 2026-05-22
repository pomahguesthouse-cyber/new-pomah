-- Add structured sections column to seo_landing_pages.
-- Stores an ordered array of typed section blocks used by the visual
-- page builder.  Falls back to hero_headline + body_content for pages
-- created before this migration.

alter table seo_landing_pages
  add column if not exists sections jsonb;
