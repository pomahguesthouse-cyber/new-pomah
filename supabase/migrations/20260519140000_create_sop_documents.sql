-- SOP knowledge base: documents (pdf/doc/docx/txt) uploaded by staff
-- and used by the AI agents as a basis for their answers.

-- Private storage bucket for the uploaded files.
insert into storage.buckets (id, name, public)
values ('sop-documents', 'sop-documents', false)
on conflict (id) do nothing;

drop policy if exists "sop-documents staff read" on storage.objects;
create policy "sop-documents staff read"
  on storage.objects for select to authenticated
  using (bucket_id = 'sop-documents');

drop policy if exists "sop-documents staff insert" on storage.objects;
create policy "sop-documents staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sop-documents');

drop policy if exists "sop-documents staff delete" on storage.objects;
create policy "sop-documents staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sop-documents');

-- Document metadata + extracted text content used by the chatbot.
create table if not exists public.sop_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  name text not null,
  file_path text,
  file_type text,
  content text,
  created_at timestamptz not null default now()
);

alter table public.sop_documents enable row level security;

create policy "staff manage sop_documents"
  on public.sop_documents for all to authenticated
  using (is_staff(auth.uid()))
  with check (is_staff(auth.uid()));

notify pgrst, 'reload schema';
