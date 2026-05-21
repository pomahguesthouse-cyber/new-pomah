-- Add doc_category to distinguish Knowledge files from SOP files.
-- Existing rows default to 'sop' for backward compatibility.
alter table sop_documents
  add column if not exists doc_category text not null default 'sop'
    check (doc_category in ('knowledge', 'sop'));
