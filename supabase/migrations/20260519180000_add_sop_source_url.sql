-- A SOP knowledge entry can also be an external link (URL) with a
-- description, not just an uploaded file.
alter table public.sop_documents
  add column if not exists source_url text;

notify pgrst, 'reload schema';
