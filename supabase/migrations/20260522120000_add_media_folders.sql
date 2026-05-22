-- Create media_folders table so users can organise media files.
create table if not exists media_folders (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  created_at  timestamptz not null default now(),
  constraint  media_folders_name_key unique (name)
);

-- Seed the four default folders that map to the existing storage prefixes.
insert into media_folders (name) values
  ('Hero Slider'),
  ('Foto Kamar'),
  ('Brosur'),
  ('Branding')
on conflict (name) do nothing;

-- Add folder column to sop_documents.
-- NULL means the file has not been assigned to any folder.
alter table sop_documents
  add column if not exists folder text;

-- Backfill existing brosur rows with sensible defaults.
update sop_documents
  set folder = 'Brosur'
  where doc_category = 'brosur'
    and (storage_bucket is null or storage_bucket = 'sop-documents');

update sop_documents
  set folder = 'Hero Slider'
  where doc_category = 'brosur'
    and storage_bucket = 'room-images'
    and file_path like 'media/%';

update sop_documents
  set folder = 'Foto Kamar'
  where doc_category = 'brosur'
    and storage_bucket = 'room-images'
    and file_path like 'room-types/%';

update sop_documents
  set folder = 'Branding'
  where doc_category = 'brosur'
    and storage_bucket = 'room-images'
    and file_path like 'branding/%';
