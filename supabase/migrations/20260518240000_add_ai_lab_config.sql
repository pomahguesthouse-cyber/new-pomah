-- Per-agent and per-tool configuration for the AI LAB, stored as a
-- single JSONB document on the property.
alter table public.properties
  add column if not exists ai_lab_config jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
