-- Rollback 20261113_bank_mutations.sql — DISIAPKAN, BELUM DIJALANKAN.
-- Tidak menghapus data yang sudah ada sebelum migrasi. Pembayaran yang
-- tercatat lewat mutasi TIDAK dibalik otomatis (uncomment blok 1 bila
-- memang ingin membatalkan pencatatan). Tabel baru DIARSIPKAN (rename).
begin;

-- 1. Opsional — balik efek pembayaran yang tercatat dari mutasi:
-- with s as (
--   select booking_id, sum(amount) amt
--     from public.payment_applications
--    where source = 'moota_mutation' or mutation_id is not null
--    group by booking_id)
-- update public.bookings b
--    set paid_amount = greatest(0, b.paid_amount - s.amt),
--        payment_status = (case when b.paid_amount - s.amt <= 0 then 'unpaid'
--                               when b.paid_amount - s.amt >= b.total_amount then 'paid'
--                               else 'partial' end)::public.payment_status
--   from s where s.booking_id = b.id;

drop function if exists public.apply_payment_with_mutation(uuid,text,text,uuid,numeric,numeric,text,numeric,text,uuid);
drop function if exists public.mark_bank_mutation_status(text,text,text);

alter table if exists public.bank_mutations drop constraint if exists bank_mutations_pending_id_fkey;
alter table if exists public.bank_mutations drop constraint if exists bank_mutations_payment_application_id_fkey;

alter index if exists public.bank_mutations_pkey rename to _archive_bm_pkey_20261113;
alter index if exists public.bank_mutations_status_amount_idx rename to _archive_bm_status_amount_idx_20261113;
alter index if exists public.bank_mutations_date_idx rename to _archive_bm_date_idx_20261113;
alter index if exists public.payment_proof_pending_pkey rename to _archive_ppp_pkey_20261113;
alter index if exists public.payment_proof_pending_message_key rename to _archive_ppp_message_key_20261113;
alter index if exists public.payment_proof_pending_status_idx rename to _archive_ppp_status_idx_20261113;
alter index if exists public.payment_proof_pending_amount_idx rename to _archive_ppp_amount_idx_20261113;
alter index if exists public.payment_applications_mutation_id_key rename to _archive_pa_mutation_id_key_20261113;

alter table if exists public.bank_mutations rename to _archive_bank_mutations_20261113;
alter table if exists public.payment_proof_pending rename to _archive_payment_proof_pending_20261113;

-- Kolom mutation_id di payment_applications dibiarkan (harmless).
-- Indeks unik parsial source_message_id tetap (lebih benar daripada NOT NULL
-- lama); tidak dikembalikan ke bentuk lama agar baris mutation-only aman.
commit;
-- Backup _bak_*_20261113 dibiarkan; hapus manual setelah yakin.
