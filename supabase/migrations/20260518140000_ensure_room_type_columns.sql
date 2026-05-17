-- Safety net: make sure room types can store amenities and a hero photo.
-- No-ops if the columns already exist.
alter table public.room_types
  add column if not exists amenities text[] not null default '{}'::text[],
  add column if not exists hero_image_url text;

notify pgrst, 'reload schema';
