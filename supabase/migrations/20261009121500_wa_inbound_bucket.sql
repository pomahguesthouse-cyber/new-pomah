-- Private bucket for inbound WhatsApp media (bukti transfer, documents, audio, video, stickers).
-- APPLY MANUALLY. Lovable deploy does not run this migration.
-- Object path (enforced in the app): {phone}/{yyyy-mm}/{message_id}.{ext}
-- The webhook uploads with the service role, which bypasses RLS.
-- Authenticated staff may read, matching the wa-outbound select policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'wa-inbound',
  'wa-inbound',
  false,
  16777216,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/opus',
    'video/mp4',
    'video/3gpp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
where not exists (
  select 1 from storage.buckets where id = 'wa-inbound'
);

drop policy if exists "wa-inbound staff select" on storage.objects;
create policy "wa-inbound staff select"
  on storage.objects for select to authenticated
  using (bucket_id = 'wa-inbound' and public.is_staff(auth.uid()));
