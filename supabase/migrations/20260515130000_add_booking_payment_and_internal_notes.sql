-- Add payment tracking and internal notes to bookings.
-- These exist on the public.bookings row so each room reservation
-- carries its own payment state — multi-room reservations distribute
-- paid_amount per room while sharing payment_status across rows.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('unpaid', 'partial', 'paid');
  end if;
end $$;

alter table public.bookings
  add column if not exists payment_status public.payment_status not null default 'unpaid',
  add column if not exists paid_amount numeric(10,2) not null default 0,
  add column if not exists internal_notes text;

create index if not exists idx_bookings_payment_status on public.bookings(payment_status);
