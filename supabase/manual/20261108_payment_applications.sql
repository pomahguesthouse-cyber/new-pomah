-- =============================================================================
-- Pencatatan pembayaran otomatis dari bukti transfer yang cocok ketat
-- (disetujui Faizal, 8 Nov 2026). DISIAPKAN — BELUM DIJALANKAN di produksi.
--
-- Sengaja di supabase/manual (bukan supabase/migrations) agar tidak terpasang
-- otomatis. Jalankan manual setelah review (SQL editor, sebagai postgres).
-- Kode PR142 aman tanpa file ini: RPC tidak ada → bukti ke staf (fail-safe).
--
-- Skema produksi diverifikasi READ-ONLY (8 Nov 2026 19.45 WIB, PG 17.6):
--   bookings.id uuid PK; total_amount/paid_amount numeric(10,2) NOT NULL
--   (paid default 0); payment_status enum payment_status{unpaid,partial,paid};
--   status enum booking_status{pending,confirmed,checked_in,checked_out,
--   cancelled,expired}; invoices.booking_id UNIQUE, payment_status_snapshot
--   text, regenerated_at timestamptz (tidak ada invoices.updated_at);
--   guests.phone / phone_normalized text; whatsapp_threads.ai_auto,
--   ai_paused_until. Default privileges schema public memberi anon/
--   authenticated hak tabel & EXECUTE fungsi → di-REVOKE eksplisit di bawah.
--   Trigger bookings: trg_bookings_updated (set updated_at) — tidak diubah.
--
-- Tidak mengubah baris yang sudah ada. Diuji di Postgres 17 lokal terisolasi
-- (scripts/sql/test-payment-applications.sh) — bukan di produksi.
-- =============================================================================

-- ── 0. Backup minimal (hanya kolom yang bisa diubah RPC; tanpa PII/rekening) ─
create table if not exists public._bak_booking_payment_20261108 as
  select id, payment_status, paid_amount, total_amount, now() as backed_up_at
  from public.bookings;
create table if not exists public._bak_invoice_payment_20261108 as
  select id, booking_id, payment_status_snapshot, regenerated_at, now() as backed_up_at
  from public.invoices;
revoke all on public._bak_booking_payment_20261108, public._bak_invoice_payment_20261108
  from public, anon, authenticated;

begin;

-- ── 1. Aplikasi pembayaran (1 baris = 1 bukti tercatat) ──────────────────────
create table public.payment_applications (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete restrict,
  source             text not null default 'wa_proof_auto',
  source_message_id  uuid not null,
  reference_no       text not null,
  reference_norm     text not null check (length(reference_norm) >= 6),
  amount             numeric(10,2) not null check (amount > 0),
  received_amount    numeric(10,2) not null,
  transfer_fee       numeric(10,2) not null default 0 check (transfer_fee between 0 and 6500),
  kind               text not null check (kind in ('dp','full','remaining')),
  paid_before        numeric(10,2) not null,
  paid_after         numeric(10,2) not null,
  status_before      text not null,
  status_after       text not null check (status_after in ('partial','paid')),
  notice_status      text not null default 'pending'
                     check (notice_status in ('pending','sending','sent','skipped','failed')),
  notice_attempts    integer not null default 0,
  notice_claim_token uuid,
  notice_lease_until timestamptz,
  notice_sent_at     timestamptz,
  notice_error       text,
  created_at         timestamptz not null default now()
);
-- Referensi unik GLOBAL (lintas booking): huruf besar, hanya [A-Z0-9].
create unique index payment_applications_reference_norm_key on public.payment_applications (reference_norm);
create unique index payment_applications_source_message_key on public.payment_applications (source_message_id);
create index payment_applications_notice_idx on public.payment_applications (notice_status, created_at);
alter table public.payment_applications enable row level security;
revoke all on public.payment_applications from public, anon, authenticated;
grant select, insert, update on public.payment_applications to service_role;

-- ── 2. Klaim notifikasi status pembayaran (edit manual admin + umum) ─────────
create table public.payment_status_notices (
  notice_key   text primary key,          -- bookingId:status:paid
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  status       text not null default 'sending' check (status in ('sending','sent','failed')),
  attempts     integer not null default 1,
  claim_token  uuid not null,
  lease_until  timestamptz not null,
  sent_at      timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);
alter table public.payment_status_notices enable row level security;
revoke all on public.payment_status_notices from public, anon, authenticated;
grant select, insert, update on public.payment_status_notices to service_role;

create or replace function public.normalize_payment_reference(p text)
returns text language sql immutable set search_path = '' as $$
  select upper(pg_catalog.regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.normalize_guest_phone_digits(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d like '0%' then '62' || substr(d, 2)
    when d like '8%' then '62' || d
    else d end
  from (select pg_catalog.regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- ── 3. RPC atomik ────────────────────────────────────────────────────────────
-- Konkurensi: SELECT … FOR UPDATE menyerialkan semua klaim per booking; klaim
-- kedua melihat paid_amount baru → 'paid_amount_changed'. Referensi sama di
-- booking lain: INSERT kedua menunggu indeks unik lalu unique_violation.
create or replace function public.apply_payment_proof(
  p_booking_id    uuid,
  p_phone         text,
  p_reference     text,
  p_message_id    uuid,
  p_amount        numeric,
  p_received      numeric,
  p_kind          text,
  p_expected_paid numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b          record;
  ref_norm   text := public.normalize_payment_reference(p_reference);
  fee        numeric := coalesce(p_received, 0) - coalesce(p_amount, 0);
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
  -- Hanya lebih bayar (biaya transfer) ≤ 6.500 ditoleransi; kurang bayar tidak.
  if fee < 0 or fee > 6500 then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  if p_kind not in ('dp','full','remaining') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind');
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
  -- Nominal harus sesuai tagihan SAAT INI (bukan data match yang basi).
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
      (booking_id, source_message_id, reference_no, reference_norm, amount, received_amount,
       transfer_fee, kind, paid_before, paid_after, status_before, status_after)
    values
      (p_booking_id, p_message_id, p_reference, ref_norm, p_amount, p_received,
       fee, p_kind, b.paid, new_paid, b.pay_status, new_status)
    returning id into app_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_reference');
  end;

  -- total_amount TIDAK diubah.
  update public.bookings
     set paid_amount = new_paid,
         payment_status = new_status::public.payment_status
   where id = p_booking_id;
  update public.invoices
     set payment_status_snapshot = new_status, regenerated_at = now()
   where booking_id = p_booking_id;

  return jsonb_build_object(
    'ok', true, 'application_id', app_id, 'paid_before', b.paid, 'paid_after', new_paid,
    'total', b.total_amount, 'status_before', b.pay_status, 'status_after', new_status);
end;
$$;

-- ── 4. Outbox notifikasi (lease + token) ─────────────────────────────────────
-- At-least-once: bila worker crash SETELAH kirim WA tetapi SEBELUM finish,
-- lease kedaluwarsa dan pesan bisa terkirim ulang. Exactly-once ke pihak luar
-- (Meta) tidak bisa dijamin. Jeda staf dicek SEBELUM klaim (tidak memakan attempt).
create or replace function public.claim_payment_notice(p_application_id uuid, p_lease_seconds integer default 300)
returns uuid
language sql
security definer
set search_path = ''
as $$
  update public.payment_applications
     set notice_status = 'sending',
         notice_claim_token = gen_random_uuid(),
         notice_lease_until = now() + make_interval(secs => p_lease_seconds),
         notice_attempts = notice_attempts + 1
   where id = p_application_id
     and notice_attempts < 5
     and (notice_status in ('pending','failed')
          or (notice_status = 'sending' and notice_lease_until < now()))
  returning notice_claim_token;
$$;

create or replace function public.finish_payment_notice(
  p_application_id uuid, p_claim_token uuid, p_outcome text, p_error text default null)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.payment_applications
       set notice_status = case when p_outcome in ('sent','skipped') then p_outcome else 'failed' end,
           notice_sent_at = case when p_outcome = 'sent' then now() else notice_sent_at end,
           notice_error = case when p_outcome in ('sent','skipped') then null else left(p_error, 300) end,
           notice_lease_until = null
     where id = p_application_id and notice_claim_token = p_claim_token and notice_status = 'sending'
    returning 1)
  select exists (select 1 from u);
$$;

create or replace function public.claim_payment_status_notice(
  p_notice_key text, p_booking_id uuid, p_lease_seconds integer default 300)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare tok uuid := gen_random_uuid(); got uuid;
begin
  insert into public.payment_status_notices (notice_key, booking_id, claim_token, lease_until)
  values (p_notice_key, p_booking_id, tok, now() + make_interval(secs => p_lease_seconds))
  on conflict (notice_key) do update
     set claim_token = excluded.claim_token,
         lease_until = excluded.lease_until,
         status = 'sending',
         attempts = public.payment_status_notices.attempts + 1
   where public.payment_status_notices.attempts < 5
     and (public.payment_status_notices.status = 'failed'
          or (public.payment_status_notices.status = 'sending'
              and public.payment_status_notices.lease_until < now()))
  returning claim_token into got;
  return got;  -- null = sudah terkirim / sedang dikirim / batas percobaan
end;
$$;

create or replace function public.finish_payment_status_notice(
  p_notice_key text, p_claim_token uuid, p_ok boolean, p_error text default null)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.payment_status_notices
       set status = case when p_ok then 'sent' else 'failed' end,
           sent_at = case when p_ok then now() else sent_at end,
           last_error = case when p_ok then null else left(p_error, 300) end
     where notice_key = p_notice_key and claim_token = p_claim_token and status = 'sending'
    returning 1)
  select exists (select 1 from u);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.normalize_payment_reference(text)',
    'public.normalize_guest_phone_digits(text)',
    'public.apply_payment_proof(uuid,text,text,uuid,numeric,numeric,text,numeric)',
    'public.claim_payment_notice(uuid,integer)',
    'public.finish_payment_notice(uuid,uuid,text,text)',
    'public.claim_payment_status_notice(text,uuid,integer)',
    'public.finish_payment_status_notice(text,uuid,boolean,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
