-- Detailed room-type availability for the AI chatbot's availability tool.
-- Like room_type_availability but returns aggregate COUNTS (total rooms,
-- taken, and free) per room type so the assistant can say e.g.
-- "2 kamar tersedia". SECURITY DEFINER so it can read bookings without
-- exposing guest data — only aggregate numbers are returned.
create or replace function public.room_type_availability_detail(
  p_check_in date,
  p_check_out date
)
returns table (room_type_id uuid, total int, taken int, available int)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select r.room_type_id as rtid, count(*)::int as total
    from public.rooms r
    where r.room_type_id is not null
    group by r.room_type_id
  ),
  occ as (
    select coalesce(br.room_type_id, rm.room_type_id) as rtid, count(*)::int as taken
    from public.booking_rooms br
    join public.bookings b on b.id = br.booking_id
    left join public.rooms rm on rm.id = br.room_id
    where b.status in ('pending', 'confirmed', 'checked_in')
      and b.check_in < p_check_out
      and b.check_out > p_check_in
    group by coalesce(br.room_type_id, rm.room_type_id)
  )
  select
    t.rtid,
    t.total,
    coalesce(o.taken, 0),
    greatest(t.total - coalesce(o.taken, 0), 0)
  from totals t
  left join occ o on o.rtid = t.rtid;
$$;

grant execute on function public.room_type_availability_detail(date, date) to anon, authenticated;

notify pgrst, 'reload schema';
