ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS explore_config JSONB NOT NULL DEFAULT '{}'::jsonb;
