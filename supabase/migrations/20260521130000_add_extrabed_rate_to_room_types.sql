-- Add extrabed_rate to room_types so each room type can have its own
-- extra-bed price per night.
alter table room_types
  add column if not exists extrabed_rate numeric(12,2) not null default 0;
