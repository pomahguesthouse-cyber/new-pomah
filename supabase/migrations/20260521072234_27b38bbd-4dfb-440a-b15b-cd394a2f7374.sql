update storage.buckets set public = true where id = 'sop-documents';
-- Allow public read on this bucket
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public read sop-documents' and tablename = 'objects' and schemaname='storage') then
    create policy "Public read sop-documents" on storage.objects for select using (bucket_id = 'sop-documents');
  end if;
end $$;