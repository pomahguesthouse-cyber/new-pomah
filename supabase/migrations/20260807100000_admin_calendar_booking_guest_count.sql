-- Booking cepat dari kalender admin: isi jumlah tamu dari kapasitas kamar.
--
-- Masalah: RPC ini sama sekali tidak mengisi `bookings.adults`, sehingga setiap
-- booking yang dibuat dari kalender memakai default kolom (1 tamu) — invoice
-- Family Room pun tertulis 1 tamu. UI bahkan sempat mengirim `adults`, tetapi
-- Zod schema di server membuangnya karena tidak dideklarasikan, jadi angkanya
-- tidak pernah sampai ke database.
--
-- Perbaikan: isi `adults` dari `room_types.capacity` kamar yang dipilih —
-- konsisten dengan aturan di src/lib/guest-count.ts (Deluxe 2, Family Room 4).
-- Extra bed TIDAK dihitung.
--
-- CATATAN SIGNATURE: sengaja TIDAK menambah parameter baru. Menambahkan
-- `p_adults integer default null` akan membuat overload kedua, dan pemanggilan
-- 6-argumen dari PostgREST menjadi ambigu (42725 "function is not unique") —
-- yang justru membuat semua booking kalender gagal. Dialog kalender cepat juga
-- tidak punya input jumlah tamu, jadi kapasitas adalah satu-satunya sumber.

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
  v_capacity integer;
  v_adults integer;
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
  select r.room_type_id, rt.property_id, rt.capacity
    into v_room_type_id, v_property_id, v_capacity
  from public.rooms r
  join public.room_types rt on rt.id = r.room_type_id
  where r.id = p_room_id
  for update of r;

  if v_room_type_id is null or v_property_id is null then
    raise exception 'Data kamar tidak ditemukan atau belum terhubung ke property.' using errcode = 'P0002';
  end if;

  -- Jumlah tamu mengikuti kapasitas standar kamar (tanpa extra bed).
  v_adults := least(greatest(1, coalesce(v_capacity, 1)), 20);

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
    adults,
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
    v_adults,
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

notify pgrst, 'reload schema';
