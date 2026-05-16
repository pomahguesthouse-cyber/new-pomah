-- ============================================================
-- Multi-room bookings — normalize rooms into a child table
-- ============================================================
-- Previously `bookings` was one row per room. A guest booking
-- several rooms produced several unrelated bookings. This makes
-- `bookings` the header (guest, dates, status, payment, total)
-- and moves each room into `booking_rooms`.
-- ============================================================

create table if not exists public.booking_rooms (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings(id) on delete cascade,
  room_id       uuid references public.rooms(id) on delete set null,
  room_type_id  uuid not null references public.room_types(id),
  nightly_rate  numeric(10,2) not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.booking_rooms enable row level security;

-- Staff manage everything.
create policy "staff manage booking_rooms"
  on public.booking_rooms for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Public booking flow inserts rooms right after creating a pending
-- booking; anon may insert (it cannot read anything back).
create policy "anon add booking_rooms"
  on public.booking_rooms for insert to anon
  with check (true);

create index if not exists idx_booking_rooms_booking on public.booking_rooms (booking_id);
create index if not exists idx_booking_rooms_room on public.booking_rooms (room_id);

-- ---- backfill: one booking_rooms row per existing booking ----
insert into public.booking_rooms (booking_id, room_id, room_type_id, nightly_rate)
select b.id, b.room_id, b.room_type_id, b.nightly_rate
from public.bookings b
where b.room_type_id is not null
  and not exists (select 1 from public.booking_rooms br where br.booking_id = b.id);

-- ---- bookings is now a header: per-room columns optional ----
alter table public.bookings alter column room_type_id drop not null;
alter table public.bookings alter column nightly_rate drop not null;

notify pgrst, 'reload schema';
