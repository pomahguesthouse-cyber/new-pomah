-- Jumlah kamar tidur dan kamar mandi per tipe kamar.
-- Default 1: Single, Deluxe, Grand Deluxe, dan tipe lain tetap 1/1.
-- Family Suite 100 dan Family Room 222 punya 2 kamar tidur dan 2 kamar mandi.
-- Idempotent: aman dijalankan ulang. Tidak mengubah kolom atau tabel lain.

ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS bedrooms integer NOT NULL DEFAULT 1;

ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS bathrooms integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_types_bedrooms_check'
      AND conrelid = 'public.room_types'::regclass
  ) THEN
    ALTER TABLE public.room_types
      ADD CONSTRAINT room_types_bedrooms_check CHECK (bedrooms >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_types_bathrooms_check'
      AND conrelid = 'public.room_types'::regclass
  ) THEN
    ALTER TABLE public.room_types
      ADD CONSTRAINT room_types_bathrooms_check CHECK (bathrooms >= 1);
  END IF;
END $$;

UPDATE public.room_types
SET bedrooms = 2,
    bathrooms = 2
WHERE name IN ('Family Suite 100', 'Family Room 222')
   OR slug IN ('family-suite-100', 'family-room-222');

NOTIFY pgrst, 'reload schema';
