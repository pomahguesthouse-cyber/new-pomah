-- Add global_config to properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS global_config JSONB;

-- Add page_type and is_system to seo_landing_pages
ALTER TABLE seo_landing_pages
  ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'landing',
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
