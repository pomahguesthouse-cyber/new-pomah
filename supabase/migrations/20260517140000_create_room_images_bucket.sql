-- Create the public 'room-images' storage bucket. It holds room photos
-- and branding assets (logos / favicon). Without it, image uploads fail
-- with "Bucket not found".

insert into storage.buckets (id, name, public)
values ('room-images', 'room-images', true)
on conflict (id) do update set public = true;

-- Anyone may read objects in this bucket (public assets).
drop policy if exists "room-images public read" on storage.objects;
create policy "room-images public read"
  on storage.objects for select
  using (bucket_id = 'room-images');

-- Authenticated staff may upload / replace / delete.
drop policy if exists "room-images staff insert" on storage.objects;
create policy "room-images staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'room-images');

drop policy if exists "room-images staff update" on storage.objects;
create policy "room-images staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'room-images')
  with check (bucket_id = 'room-images');

drop policy if exists "room-images staff delete" on storage.objects;
create policy "room-images staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'room-images');
