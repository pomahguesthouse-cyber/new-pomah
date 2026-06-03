-- ============================================================
-- Dynamic daily room rates (Pomah Pricing — PR A: foundation).
-- ============================================================
-- For every (room_type_id, date) the property may set a one-day
-- override of:
--   • rate          → replaces room_types.base_rate that night
--   • extrabed_rate → replaces room_types.extrabed_rate that night
--   • stop_sell     → kamar tipe ini tidak dijual untuk tanggal itu
--   • min_stay      → informasi (belum di-enforce; phase 2)
--
-- Rows are SPARSE: tanggal tanpa baris pakai base_rate (fallback).
-- Resolver hidup di `src/services/pricing/daily-rate.service.ts`.
--
-- Property scope diturunkan dari room_types (single-tenant praktis),
-- jadi tabel ini tidak menyimpan property_id sendiri.
-- ============================================================

create table if not exists public.room_daily_rates (
  id            uuid primary key default gen_random_uuid(),
  room_type_id  uuid not null references public.room_types(id) on delete cascade,
  date          date not null,
  rate          numeric(12,2) not null check (rate >= 0),
  extrabed_rate numeric(12,2)          check (extrabed_rate is null or extrabed_rate >= 0),
  min_stay      integer not null default 1 check (min_stay >= 1),
  stop_sell     boolean not null default false,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (room_type_id, date)
);

create index if not exists idx_room_daily_rates_room_date
  on public.room_daily_rates (room_type_id, date);

create index if not exists idx_room_daily_rates_date
  on public.room_daily_rates (date);

alter table public.room_daily_rates enable row level security;

-- Staff manage everything (UI Admin + managerial tools).
create policy "staff manage room_daily_rates"
  on public.room_daily_rates for all to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- Public availability checks need to read overrides (anon flow:
-- public booking widget calls check_room_availability tanpa auth).
-- Hanya SELECT — write tetap staff-only.
create policy "public read room_daily_rates"
  on public.room_daily_rates for select to anon, authenticated
  using (true);

create trigger room_daily_rates_set_updated_at
  before update on public.room_daily_rates
  for each row execute function public.set_updated_at();

comment on table public.room_daily_rates is
  'Sparse daily overrides for room_types.base_rate / extrabed_rate, plus stop_sell flag. Resolved by src/services/pricing/daily-rate.service.ts.';
