-- Extend doc_category to include 'brosur' for brochure/image files.
alter table sop_documents
  drop constraint if exists sop_documents_doc_category_check;

alter table sop_documents
  add constraint sop_documents_doc_category_check
    check (doc_category in ('knowledge', 'sop', 'brosur'));
