-- room_type_availability_detail: per-night stock with stop-sell.
--
-- Previous version counted every booking overlapping ANY night of the stay,
-- so multi-night ranges over-counted (e.g. 5 Deluxe "taken" of 4) and it
-- ignored room_daily_rates.stop_sell. New logic, per room type:
--   taken     = max over nights d in [check_in, check_out) of booked rooms
--               (bookings status pending/confirmed/checked_in, check_in <= d < check_out)
--   available = 0 if any night is stop_sell, else greatest(total - taken, 0)
-- Signature and return shape are unchanged. room_type_availability (boolean)
-- is redefined on top of it so every caller agrees.

create or replace function public.room_type_availability_detail(p_check_in date, p_check_out date)
returns table(room_type_id uuid, total integer, taken integer, available integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with totals as (
    select r.room_type_id as rtid, count(*)::int as total
    from public.rooms r
    where r.room_type_id is not null
    group by r.room_type_id
  ),
  nights as (
    select d::date as night
    from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  ),
  per_night as (
    select coalesce(br.room_type_id, rm.room_type_id) as rtid, n.night, count(*)::int as booked
    from nights n
    join public.bookings b
      on b.check_in <= n.night and b.check_out > n.night
     and b.status in ('pending', 'confirmed', 'checked_in')
    join public.booking_rooms br on br.booking_id = b.id
    left join public.rooms rm on rm.id = br.room_id
    group by 1, 2
  ),
  occ as (
    select rtid, max(booked)::int as taken from per_night group by rtid
  ),
  closed as (
    select distinct d.room_type_id as rtid
    from public.room_daily_rates d
    where d.stop_sell is true
      and d.date >= p_check_in
      and d.date < p_check_out
  )
  select
    t.rtid,
    t.total,
    coalesce(o.taken, 0),
    case when c.rtid is not null then 0
         else greatest(t.total - coalesce(o.taken, 0), 0) end
  from totals t
  left join occ o on o.rtid = t.rtid
  left join closed c on c.rtid = t.rtid;
$function$;

create or replace function public.room_type_availability(p_check_in date, p_check_out date)
returns table(room_type_id uuid, available boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.room_type_id, a.available > 0
  from public.room_type_availability_detail(p_check_in, p_check_out) a;
$function$;
