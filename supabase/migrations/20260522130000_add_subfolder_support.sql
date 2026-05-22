-- Subfolder support for the media library.
--
-- 1. media_folders gains a parent_id so folders can nest one or more levels deep.
--    Deleting a parent cascades to children (deletes them too).
--
-- 2. sop_documents gains folder_id (uuid FK) which replaces the text `folder`
--    column for folder assignment.  The old `folder` text column is kept so
--    existing data is not lost, but the app now reads/writes folder_id only.
--    On delete of a media_folder the FK is set to NULL (files become unassigned).

-- Add hierarchy to media_folders
alter table media_folders
  add column if not exists parent_id uuid
    references media_folders(id) on delete cascade;

-- Add FK-based folder assignment to sop_documents
alter table sop_documents
  add column if not exists folder_id uuid
    references media_folders(id) on delete set null;

-- Migrate existing text-based folder assignments → uuid folder_id
update sop_documents sd
  set folder_id = mf.id
  from media_folders mf
  where mf.name = sd.folder
    and sd.folder is not null
    and sd.folder_id is null;
