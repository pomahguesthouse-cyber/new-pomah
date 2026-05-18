-- Allow anonymous visitors to read rooms and booking_rooms so the public
-- homepage can compute room-type availability for a chosen date range.
-- These tables hold no guest PII.
drop policy if exists "anon read rooms" on public.rooms;
create policy "anon read rooms"
  on public.rooms for select to anon using (true);

drop policy if exists "anon read booking_rooms" on public.booking_rooms;
create policy "anon read booking_rooms"
  on public.booking_rooms for select to anon using (true);

notify pgrst, 'reload schema';
