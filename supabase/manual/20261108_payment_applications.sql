-- =============================================================================
-- Pencatatan pembayaran otomatis dari bukti transfer yang cocok (disetujui
-- Faizal 8 Nov 2026 19.34 WIB). DISIAPKAN, BELUM DIJALANKAN.
--
-- Sengaja di supabase/manual (bukan supabase/migrations) agar tidak ikut
-- terpasang otomatis. Jalankan manual SETELAH review, lewat SQL editor.
-- Kode di PR142 aman tanpa migrasi ini: RPC tidak ada → bukti diteruskan ke
-- staf seperti sekarang (tidak ada pencatatan otomatis).
--
-- Tidak mengubah baris yang sudah ada (bookings/invoices) — hanya objek baru.
-- =============================================================================

-- ── 0. Backup (read-only snapshot, untuk audit/rollback data) ────────────────
create table if not exists public._bak_payments_20261108 as
  select id, reference_code, payment_status, paid_amount, total_amount, updated_at
  from public.bookings;
create table if not exists public._bak_invoices_20261108 as
  select * from public.invoices;

begin;

-- ── 1. Tabel aplikasi pembayaran (satu baris = satu bukti yang dicatat) ──────
create table if not exists public.payment_applications (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete restrict,
  source             text not null default 'wa_proof_auto',
  source_message_id  uuid,
  reference_no       text not null,
  -- Referensi dinormalisasi (huruf besar, tanpa spasi/tanda) — UNIK global:
  -- bukti yang sama tidak bisa dipakai dua kali, di booking mana pun.
  reference_norm     text not null,
  amount             numeric(14,2) not null check (amount > 0),
  transfer_fee       numeric(14,2) not null default 0 check (transfer_fee >= 0),
  kind               text not null check (kind in ('dp','full','remaining')),
  paid_before        numeric(14,2) not null,
  paid_after         numeric(14,2) not null,
  status_after       text not null check (status_after in ('partial','paid')),
  notice_status      text not null default 'pending'
                     check (notice_status in ('pending','sending','sent','failed')),
  notice_attempts    integer not null default 0,
  notice_claimed_at  timestamptz,
  notice_sent_at     timestamptz,
  notice_error       text,
  created_at         timestamptz not null default now()
);
create unique index if not exists payment_applications_reference_norm_key
  on public.payment_applications (reference_norm);
create unique index if not exists payment_applications_source_message_key
  on public.payment_applications (source_message_id) where source_message_id is not null;
create index if not exists payment_applications_notice_idx
  on public.payment_applications (notice_status, created_at);

alter table public.payment_applications enable row level security;
-- Tanpa policy: hanya service role (server) yang bisa baca/tulis.

-- ── 2. RPC atomik: kunci booking, cek, catat, update total dibayar ──────────
create or replace function public.apply_payment_proof(
  p_booking_id        uuid,
  p_reference         text,
  p_message_id        uuid,
  p_amount            numeric,
  p_fee               numeric,
  p_kind              text,
  p_expected_paid     numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b          record;
  ref_norm   text := upper(regexp_replace(coalesce(p_reference,''), '[^A-Za-z0-9]', '', 'g'));
  new_paid   numeric;
  new_status text;
  app_id     uuid;
begin
  if length(ref_norm) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'missing_reference');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  select id, status, total_amount, coalesce(paid_amount,0) as paid, payment_status
    into b from bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  end if;
  if b.status::text in ('cancelled','canceled','expired') then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;
  -- Optimistic check: nominal yang dicocokkan OCR harus berdasar paid_amount
  -- yang sama dengan di DB sekarang (cegah dobel dari klaim paralel).
  if round(b.paid, 2) <> round(coalesce(p_expected_paid,0), 2) then
    return jsonb_build_object('ok', false, 'reason', 'paid_amount_changed', 'paid', b.paid);
  end if;

  new_paid := b.paid + p_amount;
  if new_paid > b.total_amount then
    return jsonb_build_object('ok', false, 'reason', 'overpayment');
  end if;
  new_status := case when new_paid >= b.total_amount then 'paid' else 'partial' end;

  begin
    insert into payment_applications
      (booking_id, source_message_id, reference_no, reference_norm, amount, transfer_fee,
       kind, paid_before, paid_after, status_after)
    values
      (p_booking_id, p_message_id, p_reference, ref_norm, p_amount, coalesce(p_fee,0),
       p_kind, b.paid, new_paid, new_status)
    returning id into app_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_reference');
  end;

  -- total_amount TIDAK diubah.
  update bookings
     set paid_amount = new_paid,
         payment_status = new_status::payment_status,
         updated_at = now()
   where id = p_booking_id;
  update invoices
     set payment_status_snapshot = new_status, regenerated_at = now()
   where booking_id = p_booking_id;

  return jsonb_build_object(
    'ok', true, 'application_id', app_id, 'paid_before', b.paid, 'paid_after', new_paid,
    'total', b.total_amount, 'status_after', new_status);
end;
$$;

-- ── 3. Klaim notifikasi atomik (outbox) ──────────────────────────────────────
create or replace function public.claim_payment_notice(p_application_id uuid, p_stale_seconds integer default 600)
returns boolean
language sql
security definer
set search_path = public
as $$
  with c as (
    update payment_applications
       set notice_status = 'sending', notice_claimed_at = now(), notice_attempts = notice_attempts + 1
     where id = p_application_id
       and notice_attempts < 5
       and (notice_status in ('pending','failed')
            or (notice_status = 'sending' and notice_claimed_at < now() - make_interval(secs => p_stale_seconds)))
    returning 1)
  select exists(select 1 from c);
$$;

create or replace function public.finish_payment_notice(p_application_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update payment_applications
     set notice_status = case when p_ok then 'sent' else 'failed' end,
         notice_sent_at = case when p_ok then now() else notice_sent_at end,
         notice_error = case when p_ok then null else left(p_error, 300) end
   where id = p_application_id and notice_status = 'sending';
$$;

revoke all on function public.apply_payment_proof(uuid,text,uuid,numeric,numeric,text,numeric) from public, anon, authenticated;
revoke all on function public.claim_payment_notice(uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_payment_notice(uuid,boolean,text) from public, anon, authenticated;

commit;

-- ── Rollback (jalankan bila perlu membatalkan; data bookings dari backup) ────
-- begin;
--   drop function if exists public.finish_payment_notice(uuid,boolean,text);
--   drop function if exists public.claim_payment_notice(uuid,integer);
--   drop function if exists public.apply_payment_proof(uuid,text,uuid,numeric,numeric,text,numeric);
--   -- Kembalikan status pembayaran booking yang diubah otomatis:
--   -- update bookings b set paid_amount = k.paid_amount, payment_status = k.payment_status
--   --   from _bak_payments_20261108 k
--   --  where k.id = b.id and b.id in (select booking_id from payment_applications);
--   drop table if exists public.payment_applications;
-- commit;
