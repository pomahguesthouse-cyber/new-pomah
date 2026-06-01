-- ============================================================
-- explore_items.category: convert from ENUM (English) to TEXT
-- (Indonesian) so it matches the rest of the codebase.
--
-- Before this migration:
--   enum explore_category: 'destination' | 'culinary' | 'event' | 'news'
-- After:
--   text column with CHECK constraint allowing:
--     'event' | 'destinasi' | 'kuliner' | 'tips'
--
-- Mapping:
--   'destination' -> 'destinasi'
--   'culinary'    -> 'kuliner'
--   'event'       -> 'event'
--   'news'        -> 'tips'          (closest equivalent in the new taxonomy)
--
-- The mismatch caused the Content Manager Agent's `upsert_explore_item`
-- tool to fail on every insert ("Sepertinya ada masalah di sistem yang
-- menyebabkan saya tidak bisa menambahkan item baru ke kategori
-- 'kuliner'…") because Postgres rejected the Indonesian value before
-- the row was written.
-- ============================================================

-- 1. Drop the default if any (enum defaults block the type change).
ALTER TABLE public.explore_items
  ALTER COLUMN category DROP DEFAULT;

-- 2. Convert the column to text, translating values inline.
ALTER TABLE public.explore_items
  ALTER COLUMN category TYPE TEXT
  USING (
    CASE category::text
      WHEN 'destination' THEN 'destinasi'
      WHEN 'culinary'    THEN 'kuliner'
      WHEN 'event'       THEN 'event'
      WHEN 'news'        THEN 'tips'
      ELSE category::text
    END
  );

-- 3. Enforce the new allow-list at the DB layer so future drift is
--    caught immediately rather than silently corrupting rows.
ALTER TABLE public.explore_items
  DROP CONSTRAINT IF EXISTS explore_items_category_check;
ALTER TABLE public.explore_items
  ADD CONSTRAINT explore_items_category_check
  CHECK (category IN ('event', 'destinasi', 'kuliner', 'tips'));

-- 4. Drop the now-orphaned enum type. Guarded so a re-run is safe.
DROP TYPE IF EXISTS public.explore_category;
