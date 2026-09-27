-- City Guide search snippet. Nullable so existing pages keep using description.
-- Lovable deploy does not run migrations. Run this once in the SQL editor.
ALTER TABLE public.explore_items
  ADD COLUMN IF NOT EXISTS meta_description text;
