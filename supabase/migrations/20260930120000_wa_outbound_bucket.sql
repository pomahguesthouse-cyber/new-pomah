-- Private bucket for files staff attach in the admin WhatsApp composer.
-- Lovable does not apply migrations automatically. Run this SQL by hand.
-- Object path (enforced in the app): {threadId}/{uuid}-{sanitized filename}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wa-outbound',
  'wa-outbound',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wa-outbound staff insert" on storage.objects;
create policy "wa-outbound staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-outbound' and public.is_staff(auth.uid()));

drop policy if exists "wa-outbound staff select" on storage.objects;
create policy "wa-outbound staff select"
  on storage.objects for select to authenticated
  using (bucket_id = 'wa-outbound' and public.is_staff(auth.uid()));

drop policy if exists "wa-outbound staff delete" on storage.objects;
create policy "wa-outbound staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'wa-outbound' and public.is_staff(auth.uid()));
