-- Rollback 20261108_payment_applications.sql — DISIAPKAN, BELUM DIJALANKAN.
-- Tidak menghapus data yang sudah ada sebelum migrasi. Pembayaran otomatis
-- dibalik dengan MENGURANGI nominal yang tercatat (bukan menimpa dari backup,
-- agar edit staf setelah migrasi tidak hilang). Tabel audit DIARSIPKAN
-- (rename), tidak di-drop.
begin;
-- 1. Balik efek pembayaran otomatis (opsional — hanya bila memang ingin
--    membatalkan pencatatan, bukan sekadar mematikan fitur):
-- with s as (select booking_id, sum(amount) amt from public.payment_applications group by booking_id)
-- update public.bookings b
--    set paid_amount = greatest(0, b.paid_amount - s.amt),
--        payment_status = (case when b.paid_amount - s.amt <= 0 then 'unpaid'
--                               when b.paid_amount - s.amt >= b.total_amount then 'paid'
--                               else 'partial' end)::public.payment_status
--   from s where s.booking_id = b.id;
-- update public.invoices i set payment_status_snapshot = b.payment_status::text, regenerated_at = now()
--   from public.bookings b where b.id = i.booking_id
--    and b.id in (select booking_id from public.payment_applications);

-- 2. Matikan fitur (kode kembali fail-safe ke staf bila RPC tidak ada):
drop function if exists public.apply_payment_proof(uuid,text,text,uuid,numeric,numeric,text,numeric);
drop function if exists public.claim_payment_notice(uuid,integer);
drop function if exists public.finish_payment_notice(uuid,uuid,text,text);
drop function if exists public.claim_payment_status_notice(text,uuid,integer);
drop function if exists public.finish_payment_status_notice(text,uuid,boolean,text);
drop function if exists public.normalize_payment_reference(text);
drop function if exists public.normalize_guest_phone_digits(text);
alter index if exists public.payment_applications_reference_norm_key rename to _archive_pa_reference_norm_key_20261108;
alter index if exists public.payment_applications_source_message_key rename to _archive_pa_source_message_key_20261108;
alter index if exists public.payment_applications_notice_idx rename to _archive_pa_notice_idx_20261108;
alter index if exists public.payment_applications_pkey rename to _archive_pa_pkey_20261108;
alter index if exists public.payment_status_notices_pkey rename to _archive_psn_pkey_20261108;
alter table if exists public.payment_applications rename to _archive_payment_applications_20261108;
alter table if exists public.payment_status_notices rename to _archive_payment_status_notices_20261108;
commit;
-- Backup _bak_*_20261108 dibiarkan; hapus manual setelah yakin.
