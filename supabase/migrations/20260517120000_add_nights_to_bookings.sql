-- Add a stored `nights` (stay length) column to bookings.
-- Derived from check_out - check_in; kept in sync by the booking
-- server functions. Having the column also makes any write that
-- includes `nights` succeed instead of failing the schema cache.
alter table public.bookings
  add column if not exists nights integer;

-- Backfill existing rows.
update public.bookings
  set nights = (check_out - check_in)
  where nights is null;

notify pgrst, 'reload schema';
