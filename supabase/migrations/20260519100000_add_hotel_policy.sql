-- Editable hotel policy text shown in the booking confirmation dialog.
-- One policy point per line.
alter table public.properties
  add column if not exists hotel_policy text;

notify pgrst, 'reload schema';
