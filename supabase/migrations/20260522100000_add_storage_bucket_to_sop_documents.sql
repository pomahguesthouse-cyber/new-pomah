-- Add storage_bucket column to sop_documents so that media files from
-- non-default buckets (e.g. room-images) can be tracked with full metadata.
-- NULL / 'sop-documents' both mean the file lives in the sop-documents bucket.
alter table sop_documents
  add column if not exists storage_bucket text;
