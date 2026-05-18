-- Payment method and requested check-in/out times captured by the
-- public booking confirmation dialog.
alter table public.bookings
  add column if not exists payment_method text,
  add column if not exists check_in_time text,
  add column if not exists check_out_time text;

notify pgrst, 'reload schema';
