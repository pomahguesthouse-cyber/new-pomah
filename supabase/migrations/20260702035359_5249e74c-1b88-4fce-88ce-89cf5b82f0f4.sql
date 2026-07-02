ALTER TABLE public.booking_rooms
  ADD COLUMN IF NOT EXISTS extra_bed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_bed_rate numeric NOT NULL DEFAULT 0;