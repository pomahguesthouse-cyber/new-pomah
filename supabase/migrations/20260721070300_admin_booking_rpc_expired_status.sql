-- Kedua RPC di bawah (dipakai admin calendar view via calendar.functions.ts)
-- memvalidasi p_status dengan daftar hardcoded yang belum mengenal 'expired'.
-- Perbarui agar admin bisa memilih status 'expired' secara manual dari
-- kalender juga (konsisten dengan dashboard bookings), dan tambahkan
-- expires_at pada booking baru yang dibuat lewat kalender.

create or replace function public.create_admin_booking_with_lock(
  p_guest_name text,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_nightly_rate numeric,
  p_status text default 'pending'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid;
  v_booking_id uuid;
  v_room_type_id uuid;
  v_property_id uuid;
  v_nights integer;
  v_conflict record;
begin
  if p_guest_name is null or length(trim(p_guest_name)) < 2 then
    raise exception 'Nama tamu wajib diisi.' using errcode = '22023';
  end if;

  if p_room_id is null then
    raise exception 'Room ID wajib diisi.' using errcode = '22023';
  end if;

  if p_check_in is null or p_check_out is null then
    raise exception 'Tanggal check-in dan check-out wajib diisi.' using errcode = '22023';
  end if;

  if p_check_out <= p_check_in then
    raise exception 'Tanggal check-out harus setelah tanggal check-in.' using errcode = '22023';
  end if;

  if p_nightly_rate is null or p_nightly_rate < 0 then
    raise exception 'Harga kamar tidak boleh negatif.' using errcode = '22023';
  end if;

  if p_status not in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired') then
    raise exception 'Status booking tidak valid: %', p_status using errcode = '22023';
  end if;

  v_nights := greatest(1, p_check_out - p_check_in);

  -- Lock the selected room row for this transaction. This serializes competing
  -- bookings for the same physical room, preventing race-condition double booking.
  select r.room_type_id, rt.property_id
    into v_room_type_id, v_property_id
  from public.rooms r
  join public.room_types rt on rt.id = r.room_type_id
  where r.id = p_room_id
  for update of r;

  if v_room_type_id is null or v_property_id is null then
    raise exception 'Data kamar tidak ditemukan atau belum terhubung ke property.' using errcode = 'P0002';
  end if;

  select b.id, b.reference_code, b.check_in, b.check_out, b.status
    into v_conflict
  from public.booking_rooms br
  join public.bookings b on b.id = br.booking_id
  where br.room_id = p_room_id
    and b.status in ('pending', 'confirmed', 'checked_in')
    and b.check_in < p_check_out
    and b.check_out > p_check_in
  order by b.check_in asc
  limit 1;

  if found then
    raise exception 'Kamar sudah terpakai pada % sampai %. Pilih kamar atau tanggal lain.',
      v_conflict.check_in,
      v_conflict.check_out
      using errcode = '23P01';
  end if;

  insert into public.guests (full_name)
  values (trim(p_guest_name))
  returning id into v_guest_id;

  insert into public.bookings (
    property_id,
    guest_id,
    check_in,
    check_out,
    nights,
    status,
    total_amount,
    source,
    expires_at
  )
  values (
    v_property_id,
    v_guest_id,
    p_check_in,
    p_check_out,
    v_nights,
    p_status,
    p_nightly_rate * v_nights,
    'direct',
    now() + interval '1 hour'
  )
  returning id into v_booking_id;

  insert into public.booking_rooms (
    booking_id,
    room_id,
    room_type_id,
    nightly_rate
  )
  values (
    v_booking_id,
    p_room_id,
    v_room_type_id,
    p_nightly_rate
  );

  return v_booking_id;
end;
$$;

grant execute on function public.create_admin_booking_with_lock(text, uuid, date, date, numeric, text) to authenticated;

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

  if p_status not in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired') then
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
