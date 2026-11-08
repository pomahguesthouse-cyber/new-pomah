-- Skema minimal (DDL saja, tanpa data) meniru produksi yang diverifikasi
-- read-only 8 Nov 2026. HANYA untuk Postgres lokal terisolasi.
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Meniru default privileges Supabase (anon/authenticated dapat hak default).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create type public.booking_status as enum ('pending','confirmed','checked_in','checked_out','cancelled','expired');
create type public.payment_status as enum ('unpaid','partial','paid');
create table public.guests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null, phone text, phone_normalized text);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  reference_code text not null,
  check_in date not null, check_out date not null,
  total_amount numeric(10,2) not null,
  status public.booking_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  paid_amount numeric(10,2) not null default 0,
  updated_at timestamptz not null default now(),
  check (check_out > check_in));
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_bookings_updated before update on public.bookings for each row execute function public.set_updated_at();
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  invoice_number text not null, payment_status_snapshot text, regenerated_at timestamptz,
  created_at timestamptz not null default now());
alter table public.bookings enable row level security;
alter table public.invoices enable row level security;
