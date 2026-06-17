## Tujuan
Mengirim alert ke manager (WhatsApp + agen Telegram Front-Office/Manager) tiap kali field penting sebuah reservasi berubah — terlepas dari kanal (Admin Bookings, Admin Calendar, AI tool Telegram/WhatsApp).

## Lingkup perubahan yang memicu alert
Hanya kirim alert kalau salah satu field berikut berubah dibanding nilai sebelumnya:
- `check_in` / `check_out` (tanggal)
- `adults` / `children` (jumlah tamu)
- Set kamar pada `booking_rooms` (room_id atau room_type_id berubah / ditambah / dihapus)

Perubahan yang **tidak** memicu alert: status (sudah ada flow notifikasi sendiri seperti `checked_in`, `cancelled`), payment_status, catatan internal, perubahan kontak tamu. Ini untuk hindari spam.

## Perubahan teknis

1. **`src/services/manager-notifier.service.ts`**
   - Tambah `"booking_updated"` ke union `SendOptions["eventType"]`.
   - Tambah fungsi baru `notifyBookingUpdated(db, bookingId, changes)` dengan signature:
     ```ts
     notifyBookingUpdated(db, bookingId, {
       dates?: { from: { checkIn, checkOut }, to: { checkIn, checkOut } };
       guests?: { from: { adults, children }, to: { adults, children } };
       rooms?:  { from: string[]; to: string[] }; // daftar nama kamar/room type
       actor?: string; // "Admin", "Manager (Telegram)", dst — untuk konteks
     })
     ```
   - Format pesan:
     ```
     ✏️ BOOKING UPDATED
     Guest: <nama>
     Booking: <reference_code>
     Source: <sourceLabel>

     Perubahan:
     • Check-in: 12/06/2026 → 14/06/2026
     • Check-out: 15/06/2026 → 17/06/2026
     • Tamu: 2 dewasa / 0 anak → 3 dewasa / 1 anak
     • Kamar: Deluxe 101 → Deluxe 202

     Diubah oleh: Admin
     ```
   - Fan-out ke WA managers + agen `front-office` & `manager` (pola sama dengan `notifyNewBooking`).
   - Dedupe: `booking_updated:${bookingId}:${hashOfChanges}:${m.id}` agar update beruntun yang persis sama tidak double-fire, tapi update baru tetap lolos.

2. **`src/admin/functions/bookings.functions.ts` → `updateBookingFull`**
   - Sebelum `update`, fetch snapshot lama (`check_in`, `check_out`, `adults`, `children`, daftar `booking_rooms.room_id` + nama kamar/tipe).
   - Setelah update + replace `booking_rooms`, hitung diff hanya untuk field tracked.
   - Jika ada perubahan, `runDeferred("updateBookingFull.notifyBookingUpdated", …)` panggil `notifyBookingUpdated` dengan `actor: "Admin"`.

3. **`src/admin/functions/calendar.functions.ts` → `updateBookingFromAdmin`**
   - Flow ini memindah kamar via drag/drop kalender. Bandingkan room set sebelum/sesudah `updateBookingStatusWithLock` (dia mengubah `booking_rooms.room_id` saat `roomId` dikirim).
   - Jika `roomId` berubah, panggil `notifyBookingUpdated` dengan `actor: "Admin (Calendar)"`.
   - Status changes (cancel, check-in, check-out) tidak ikut alert ini.

4. **`src/tools/manager/change-booking-room.tool.ts`**
   - Setelah berhasil pindah kamar, panggil `notifyBookingUpdated` dengan `actor: "Manager (chat)"`.
   - Pakai pola `runDeferred` + dynamic import sama seperti `booking.tool.ts`.

5. **Helper diff** (di `manager-notifier.service.ts`, internal)
   - `buildBookingChangeSnapshot(db, bookingId)` mengambil snapshot terstruktur dipakai sebelum & sesudah update — caller menyimpan snapshot lama, lalu mem-pass ke `notifyBookingUpdated` bersama snapshot baru. Hash dedupe dihitung dari kombinasi field yang berubah.

## Yang tidak diubah
- Tidak menyentuh schema database.
- Tidak mengubah notifikasi invoice / payment / status existing.
- Tidak mengubah UI Admin.

## Verifikasi
- Build TanStack.
- Manual: edit booking dari Admin → cek log `[ManagerNotifier]` dan masuknya `notification_logs` baru dengan `event_type = booking_updated`.
- Edit tanpa perubahan tanggal/tamu/kamar (mis. hanya catatan internal) → tidak ada alert.