-- =============================================================================
-- Integrasi mutasi Moota + pencocokan bukti transfer.
-- DISIAPKAN — BELUM DIJALANKAN di produksi.
--
-- Sengaja di supabase/manual (bukan supabase/migrations) agar tidak terpasang
-- otomatis. Jalankan manual setelah review (SQL editor, sebagai postgres),
-- DENGAN BACKUP terlebih dahulu.
--
-- Prasyarat: 20261108_payment_applications.sql sudah dijalankan (tabel
-- payment_applications + RPC apply_payment_proof).
-- Kode aman tanpa file ini: mode require_mutation gagal-aman ke 'not_migrated'
-- / antrean staf; webhook menolak/menyimpan gagal tanpa mengubah pembayaran.
--
-- Tidak mengubah baris pembayaran yang sudah ada. Diuji di Postgres 17 lokal
-- terisolasi (scripts/sql/test-bank-mutations.sh) — bukan di produksi.
-- =============================================================================

-- ── 0. Backup minimal (kolom pembayaran yang bisa berubah; tanpa PII/rekening)
create table if not exists public._bak_booking_payment_20261113 as
  select id, payment_status, paid_amount, total_amount, now() as backed_up_at
  from public.bookings;
create table if not exists public._bak_invoice_payment_20261113 as
  select id, booking_id, payment_status_snapshot, regenerated_at, now() as backed_up_at
  from public.invoices;
revoke all on public._bak_booking_payment_20261113, public._bak_invoice_payment_20261113
  from public, anon, authenticated;

begin;

-- ── 1. Kolom pengait mutasi pada aplikasi pembayaran ─────────────────────────
alter table public.payment_applications
  alter column source_message_id drop not null;
alter table public.payment_applications
  add column if not exists mutation_id text;

drop index if exists public.payment_applications_source_message_key;
create unique index payment_applications_source_message_key
  on public.payment_applications (source_message_id)
  where source_message_id is not null;
create unique index if not exists payment_applications_mutation_id_key
  on public.payment_applications (mutation_id)
  where mutation_id is not null;

-- ── 2. Mutasi bank mentah (idempotent per mutation_id) ───────────────────────
create table if not exists public.bank_mutations (
  mutation_id            text primary key,
  account_number         text,
  mutation_date          timestamptz,
  description            text,
  amount                 numeric(14,2) not null check (amount >= 0),
  type                   text not null check (type in ('CR','DB')),
  balance                numeric(14,2),
  bank_id                text,
  bank_type              text,
  raw                    jsonb not null default '{}'::jsonb,
  match_status           text not null default 'unmatched'
                         check (match_status in ('unmatched','matched','review','ignored_debit','ignored_account','ignored_bank')),
  match_reason           text,
  payment_application_id uuid references public.payment_applications(id) on delete set null,
  pending_id             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists bank_mutations_status_amount_idx
  on public.bank_mutations (match_status, amount, mutation_date);
create index if not exists bank_mutations_date_idx
  on public.bank_mutations (mutation_date);
alter table public.bank_mutations enable row level security;
revoke all on public.bank_mutations from public, anon, authenticated;
grant select, insert, update on public.bank_mutations to service_role;

-- ── 3. Bukti yang menunggu mutasi (mode require_mutation) ────────────────────
create table if not exists public.payment_proof_pending (
  id                 uuid primary key default gen_random_uuid(),
  message_id         uuid not null,
  booking_id         uuid not null references public.bookings(id) on delete restrict,
  booking_code       text not null,
  phone              text not null,
  reference_no       text not null,
  reference_norm     text not null check (length(reference_norm) >= 6),
  amount             numeric(10,2) not null check (amount > 0),
  received_amount    numeric(10,2) not null,
  kind               text not null check (kind in ('dp','full','remaining')),
  expected_paid      numeric(10,2) not null,
  status             text not null default 'waiting_mutation'
                     check (status in ('waiting_mutation','applied','expired','review','rejected')),
  match_reason       text,
  mutation_id        text,
  timeout_notified_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists payment_proof_pending_message_key
  on public.payment_proof_pending (message_id);
create index if not exists payment_proof_pending_status_idx
  on public.payment_proof_pending (status, created_at);
create index if not exists payment_proof_pending_amount_idx
  on public.payment_proof_pending (amount, status);
alter table public.payment_proof_pending enable row level security;
revoke all on public.payment_proof_pending from public, anon, authenticated;
grant select, insert, update on public.payment_proof_pending to service_role;

alter table public.bank_mutations
  drop constraint if exists bank_mutations_pending_id_fkey;
alter table public.bank_mutations
  add constraint bank_mutations_pending_id_fkey
  foreign key (pending_id) references public.payment_proof_pending(id) on delete set null;

-- ── 4. RPC: terapkan pembayaran + kunci mutasi dalam satu transaksi ──────────
-- Konkurensi: FOR UPDATE pada bookings + bank_mutations (+ pending bila ada).
-- Satu mutation_id hanya bisa dicatat sekali (unik di payment_applications).
create or replace function public.apply_payment_with_mutation(
  p_booking_id    uuid,
  p_phone         text,
  p_reference     text,
  p_message_id    uuid,
  p_amount        numeric,
  p_received      numeric,
  p_kind          text,
  p_expected_paid numeric,
  p_mutation_id   text,
  p_pending_id    uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b          record;
  mut        record;
  pend       record;
  ref_norm   text := public.normalize_payment_reference(p_reference);
  fee        numeric := coalesce(p_received, 0) - coalesce(p_amount, 0);
  new_paid   numeric;
  new_status text;
  app_id     uuid;
begin
  if p_mutation_id is null or length(trim(p_mutation_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_mutation');
  end if;
  if p_message_id is null and length(ref_norm) < 6 then
    ref_norm := public.normalize_payment_reference(p_mutation_id);
  end if;
  if length(ref_norm) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'missing_reference');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;
  if fee < 0 or fee > 6500 then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  if p_kind not in ('dp','full','remaining') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  end if;

  select m.mutation_id, m.type, m.match_status, m.amount, m.account_number
    into mut
    from public.bank_mutations m
   where m.mutation_id = p_mutation_id
     for update of m;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'mutation_not_found');
  end if;
  if mut.type <> 'CR' then
    return jsonb_build_object('ok', false, 'reason', 'ignored_debit');
  end if;
  if mut.match_status = 'matched' then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_mutation');
  end if;

  if p_pending_id is not null then
    select p.id, p.status, p.booking_id, p.message_id
      into pend
      from public.payment_proof_pending p
     where p.id = p_pending_id
       for update of p;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'pending_not_found');
    end if;
    if pend.status not in ('waiting_mutation','review') then
      return jsonb_build_object('ok', false, 'reason', 'pending_not_open');
    end if;
    if pend.booking_id <> p_booking_id then
      return jsonb_build_object('ok', false, 'reason', 'pending_booking_mismatch');
    end if;
  end if;

  select bk.id, bk.status::text as status, bk.total_amount, bk.paid_amount as paid,
         bk.payment_status::text as pay_status, g.phone, g.phone_normalized
    into b
    from public.bookings bk
    join public.guests g on g.id = bk.guest_id
   where bk.id = p_booking_id
     for update of bk;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  end if;
  if public.normalize_guest_phone_digits(p_phone) not in (
       public.normalize_guest_phone_digits(b.phone),
       public.normalize_guest_phone_digits(b.phone_normalized)) then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if b.status in ('cancelled','expired','checked_out') then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;
  if b.paid <> coalesce(p_expected_paid, -1) then
    return jsonb_build_object('ok', false, 'reason', 'paid_amount_changed');
  end if;
  if p_kind in ('full','remaining') and p_amount <> b.total_amount - b.paid then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  if p_kind = 'dp' and not (b.paid = 0 and p_amount < b.total_amount) then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  new_paid := b.paid + p_amount;
  new_status := case when new_paid >= b.total_amount then 'paid' else 'partial' end;

  begin
    insert into public.payment_applications
      (booking_id, source, source_message_id, reference_no, reference_norm, amount, received_amount,
       transfer_fee, kind, paid_before, paid_after, status_before, status_after, mutation_id)
    values
      (p_booking_id, 'moota_mutation', p_message_id, coalesce(p_reference, p_mutation_id), ref_norm,
       p_amount, p_received, fee, p_kind, b.paid, new_paid, b.pay_status, new_status, p_mutation_id)
    returning id into app_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_reference');
  end;

  update public.bookings
     set paid_amount = new_paid,
         payment_status = new_status::public.payment_status
   where id = p_booking_id;
  update public.invoices
     set payment_status_snapshot = new_status, regenerated_at = now()
   where booking_id = p_booking_id;
  update public.bank_mutations
     set match_status = 'matched',
         match_reason = 'applied',
         payment_application_id = app_id,
         pending_id = coalesce(p_pending_id, pending_id),
         updated_at = now()
   where mutation_id = p_mutation_id;
  if p_pending_id is not null then
    update public.payment_proof_pending
       set status = 'applied',
           mutation_id = p_mutation_id,
           updated_at = now()
     where id = p_pending_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'application_id', app_id, 'paid_before', b.paid, 'paid_after', new_paid,
    'total', b.total_amount, 'status_before', b.pay_status, 'status_after', new_status,
    'mutation_id', p_mutation_id);
end;
$$;

create or replace function public.mark_bank_mutation_status(
  p_mutation_id text, p_status text, p_reason text default null)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.bank_mutations
     set match_status = p_status,
         match_reason = left(p_reason, 300),
         updated_at = now()
   where mutation_id = p_mutation_id
     and match_status is distinct from 'matched'
     and p_status in ('unmatched','review','ignored_debit','ignored_account','ignored_bank')
  returning true;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.apply_payment_with_mutation(uuid,text,text,uuid,numeric,numeric,text,numeric,text,uuid)',
    'public.mark_bank_mutation_status(text,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
