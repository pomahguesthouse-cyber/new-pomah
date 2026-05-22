-- Advanced SEO fields for landing pages: custom head scripts,
-- custom robots directives, and JSON-LD structured data.
alter table seo_landing_pages
  add column if not exists custom_head     text,
  add column if not exists custom_robots   text,
  add column if not exists json_ld_enabled boolean not null default true,
  add column if not exists custom_json_ld  text;
