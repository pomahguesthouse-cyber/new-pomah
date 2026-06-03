create or replace function public.update_booking_room_with_lock(
  p_booking_id uuid,
  p_booking_room_id uuid,
  p_room_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in date;
  v_check_out date;
  v_room_type_id uuid;
  v_conflict record;
begin
  if p_booking_id is null then
    raise exception 'Booking ID wajib diisi.' using errcode = '22023';
  end if;

  if p_status not in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled') then
    raise exception 'Status booking tidak valid: %', p_status using errcode = '22023';
  end if;

  select b.check_in, b.check_out
    into v_check_in, v_check_out
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if v_check_in is null or v_check_out is null then
    raise exception 'Booking tidak ditemukan.' using errcode = 'P0002';
  end if;

  if p_booking_room_id is not null then
    perform 1
    from public.booking_rooms br
    where br.id = p_booking_room_id
      and br.booking_id = p_booking_id
    for update;

    if not found then
      raise exception 'Booking room tidak ditemukan atau tidak sesuai dengan booking.' using errcode = 'P0002';
    end if;
  end if;

  if p_room_id is not null then
    select r.room_type_id
      into v_room_type_id
    from public.rooms r
    where r.id = p_room_id
    for update;

    if v_room_type_id is null then
      raise exception 'Kamar tidak ditemukan.' using errcode = 'P0002';
    end if;

    select b.id, b.reference_code, b.check_in, b.check_out, b.status
      into v_conflict
    from public.booking_rooms br
    join public.bookings b on b.id = br.booking_id
    where br.room_id = p_room_id
      and b.id <> p_booking_id
      and b.status in ('pending', 'confirmed', 'checked_in')
      and b.check_in < v_check_out
      and b.check_out > v_check_in
    order by b.check_in asc
    limit 1;

    if found then
      raise exception 'Kamar sudah terpakai pada % sampai %. Pilih kamar atau tanggal lain.',
        v_conflict.check_in,
        v_conflict.check_out
        using errcode = '23P01';
    end if;
  end if;

  update public.bookings
  set status = p_status
  where id = p_booking_id;

  if p_booking_room_id is not null then
    update public.booking_rooms
    set
      room_id = p_room_id,
      room_type_id = coalesce(v_room_type_id, room_type_id)
    where id = p_booking_room_id
      and booking_id = p_booking_id;
  end if;
end;
$$;

grant execute on function public.update_booking_room_with_lock(uuid, uuid, uuid, text) to authenticated;
