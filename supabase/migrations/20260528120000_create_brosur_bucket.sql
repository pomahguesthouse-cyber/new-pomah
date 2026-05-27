-- Public 'brosur' bucket: holds brochure files (PDF/images) the chatbot sends
-- to guests on request. Must be public so the Fonnte WhatsApp gateway can fetch
-- the file URL. SOP/knowledge stay private in 'sop-documents'.

insert into storage.buckets (id, name, public)
values ('brosur', 'brosur', true)
on conflict (id) do update set public = true;

-- Anyone may read (Fonnte downloads via the public URL).
drop policy if exists "brosur public read" on storage.objects;
create policy "brosur public read"
  on storage.objects for select
  using (bucket_id = 'brosur');

-- Only authenticated staff may upload / replace / delete.
drop policy if exists "brosur staff insert" on storage.objects;
create policy "brosur staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'brosur' and public.is_staff(auth.uid()));

drop policy if exists "brosur staff update" on storage.objects;
create policy "brosur staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'brosur' and public.is_staff(auth.uid()))
  with check (bucket_id = 'brosur' and public.is_staff(auth.uid()));

drop policy if exists "brosur staff delete" on storage.objects;
create policy "brosur staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'brosur' and public.is_staff(auth.uid()));
