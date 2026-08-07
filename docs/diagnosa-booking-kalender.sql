-- Diagnosa "Gagal menyimpan booking" dari kalender admin.
-- Jalankan berurutan di Supabase Dashboard → SQL Editor.
-- Query 4 akan menampilkan pesan error Postgres yang SEBENARNYA — itu yang
-- selama ini disembunyikan oleh toast generik di UI.

-- ── 1. Apakah fungsinya ada, dan berapa banyak? ─────────────────────────────
-- Kalau HASILNYA KOSONG  → migrasi belum pernah dijalankan (error 42883).
-- Kalau HASILNYA 2 BARIS → ada overload ganda; pemanggilan dari aplikasi jadi
--                          ambigu (error 42725) dan SEMUA booking akan gagal.
--                          Perbaikan: DROP signature yang tidak dipakai.
select
  p.oid::regprocedure as signature,
  pg_get_function_identity_arguments(p.oid) as argumen,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_admin_booking_with_lock';

-- ── 2. Apakah role `authenticated` boleh menjalankannya? ────────────────────
-- Kalau kosong → error 42501 (permission denied).
select
  p.oid::regprocedure as signature,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as boleh_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_admin_booking_with_lock';

-- ── 3. Ambil room_id kamar yang dipakai saat gagal (contoh: 203) ────────────
select r.id as room_id, r.number, rt.name as tipe, rt.capacity, rt.property_id
from public.rooms r
join public.room_types rt on rt.id = r.room_type_id
where r.number = '203';

-- ── 4. Jalankan RPC persis seperti aplikasi ─────────────────────────────────
-- Ganti <ROOM_ID> dengan room_id dari query 3. Pesan error yang muncul di sini
-- adalah penyebab sebenarnya.
-- CATATAN: kalau berhasil, ia benar-benar MEMBUAT booking — hapus lagi dengan
-- query 6 kalau itu cuma percobaan.
select public.create_admin_booking_with_lock(
  'blok',
  '<ROOM_ID>'::uuid,
  '2026-08-07'::date,
  '2026-08-08'::date,
  300000,
  'confirmed'
) as booking_id_baru;

-- ── 5. Kalau error-nya soal bentrok: siapa yang memakai kamar itu? ──────────
select b.reference_code, b.status, b.check_in, b.check_out, g.full_name
from public.booking_rooms br
join public.bookings b on b.id = br.booking_id
left join public.guests g on g.id = b.guest_id
where br.room_id = '<ROOM_ID>'::uuid
  and b.status in ('pending', 'confirmed', 'checked_in')
  and b.check_in < '2026-08-08'::date
  and b.check_out > '2026-08-07'::date
order by b.check_in;

-- ── 6. Bersihkan booking percobaan dari query 4 (opsional) ──────────────────
-- delete from public.bookings where id = '<BOOKING_ID_BARU>'::uuid;

-- ── 7. Bonus: tipe kamar tanpa kamar fisik terdaftar ────────────────────────
-- Baris dengan jumlah_kamar_fisik = 0 tidak akan pernah bisa dijual bot,
-- dan itu penyebab balasan "kamar belum ada di sistem" di WhatsApp.
select rt.name, count(r.id) as jumlah_kamar_fisik
from public.room_types rt
left join public.rooms r on r.room_type_id = rt.id
group by rt.id, rt.name
order by jumlah_kamar_fisik asc;
