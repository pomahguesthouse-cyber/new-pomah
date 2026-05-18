-- Multiple gallery photos per room type. The first entry is the cover;
-- `hero_image_url` is kept in sync with it for existing consumers.
alter table public.room_types
  add column if not exists images text[] not null default '{}'::text[];

notify pgrst, 'reload schema';
