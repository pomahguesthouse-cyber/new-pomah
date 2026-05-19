-- Add extrabed_capacity to room_types
ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS extrabed_capacity INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
