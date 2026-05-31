## Manager Agent — Notification & Escalation System

Tujuan: Manager Agent menerima event operasional penting (booking baru, bukti transfer, komplain tamu) lewat WhatsApp secara otomatis, dengan retry, logging, dan halaman tindak lanjut untuk komplain.

### Catatan keputusan

- **Reuse tabel `property_managers`** yang sudah ada (kolom `name`, `phone`, `role` di mana `role ∈ super_admin | booking_manager | viewer`). Cukup tambah kolom `is_active`. Tidak membuat tabel `manager_contacts` baru karena akan duplikat.
- **Super admin** = `property_managers` dengan `role='super_admin' AND is_active=true` (tidak menambah kolom `super_admin_phone` di `properties`).
- Pengiriman pakai layanan Fonnte yang sudah ada (`src/services/whatsapp.service.ts` + `properties.fonnte_token`).

### 1. Database migration

Satu migration menambah/membuat:

- `ALTER TABLE property_managers ADD COLUMN is_active boolean NOT NULL DEFAULT true`.
- `CREATE TABLE notification_logs` — kolom domain: `event_type` (`new_booking | payment_proof | complaint`), `recipient_phone`, `recipient_role`, `message`, `attachment_url`, `status` (`pending | sent | failed`), `attempts`, `error`, `dedupe_key` (unik, untuk anti-duplikat), `sent_at`. + GRANT + RLS staff-only.
- `CREATE TABLE guest_complaints` — `guest_name`, `phone`, `thread_id`, `booking_id` (nullable), `category`, `message`, `confidence`, `status` (`OPEN | IN_PROGRESS | RESOLVED | CLOSED` default `OPEN`), `assigned_to`, `resolved_at`, `notes`. + GRANT + RLS staff-only + trigger `set_updated_at`.

### 2. Notifier service

File baru `src/services/manager-notifier.service.ts`:

- `notifyNewBooking(bookingId)` — ambil booking + guest + room_type, render template "🏨 NEW BOOKING ALERT", kirim ke semua manager aktif (semua role).
- `notifyPaymentProof({ threadId, guestName, bookingCode, imageUrl })` — render "💳 PAYMENT PROOF RECEIVED", kirim ke `super_admin` saja, sertakan `fileUrl` ke `sendWhatsAppMessage`. `dedupe_key = "payment_proof:" + messageId` untuk cegah duplikat.
- `notifyComplaint({ complaintId })` — render "🚨 GUEST COMPLAINT DETECTED", kirim ke semua manager aktif.
- Helper `sendWithRetry(recipient, message, fileUrl?, dedupeKey)` — insert row `notification_logs` (status=pending), retry 3× dengan backoff (1s, 2s, 4s), update status `sent/failed`. Idempoten via `dedupe_key` unik.
- Semua handler dipanggil **fire-and-forget** (`void notifier(...).catch(log)`) dari titik pemicu, jadi tidak memblokir alur utama.

### 3. Pemicu (triggers)

- **Website booking** — `src/public/functions/public.functions.ts` setelah booking insert sukses → panggil `notifyNewBooking(id)`.
- **WhatsApp AI booking** — `src/tools/booking.tool.ts` `createBooking` (juga menangani booking lewat state machine) setelah `bookings.insert(...).select()` sukses → panggil notifier (source: `direct/whatsapp`).
- **Admin booking** — `src/admin/functions/calendar.functions.ts` di handler create booking → panggil notifier (source: `admin`).
- **OTA import** — hook yang sama bila ada path import; jika belum ada, tinggalkan TODO terdokumentasi (di luar scope minimal).
- **Payment proof** — di `src/routes/api.fonnte.ts` / `src/webhook/parser.ts`, deteksi inbound message dengan `attachment/image url` (Fonnte field `url`/`media`). Bila ada: simpan ke `whatsapp_messages` seperti biasa, lalu fire-and-forget `notifyPaymentProof` dengan `guestName` dari thread + booking aktif (kalau ada `bookings` terbaru untuk phone tsb).
- **Complaint** — di `src/ai/multi-agent-orchestrator.ts` setelah intent classification: bila intent ∈ {`complaint`, `maintenance`, `service_issue`, `noise`, `cleanliness`, `urgent`} **dan** confidence > 0.7 → `INSERT INTO guest_complaints (status=OPEN, ...)` + fire-and-forget `notifyComplaint(id)`. Kategori intent dipetakan ke `category`. (Intent-classifier diperluas: tambah keyword/intent untuk noise, cleanliness, maintenance, urgent jika belum.)

### 4. UI admin — halaman Komplain

- Route baru `src/routes/admin/complaints.tsx` + modul `src/admin/modules/complaints/`.
  - `complaints.functions.ts`: `listComplaints`, `updateComplaintStatus({id, status, notes?})`, `assignComplaint`.
  - `complaints-view.tsx`: tabel komplain (filter status), detail drawer, tombol ubah status (OPEN → IN_PROGRESS → RESOLVED → CLOSED), kolom catatan, link ke thread WhatsApp & booking.
- Tambah link sidebar di `src/admin/layout` (tempat menu admin yang sudah ada).
- Halaman log notifikasi opsional: tab di Settings → "Notifikasi Manager" yang menampilkan `notification_logs` (read-only) untuk audit. (Bisa fase 2 — sebut sebagai opsional.)

### 5. Template pesan

Template literal di notifier mengikuti format yang diminta user (NEW BOOKING ALERT, PAYMENT PROOF RECEIVED, GUEST COMPLAINT DETECTED) dengan placeholder yang diisi dari DB. Format datetime: DD/MM/YYYY (sesuai workspace standard).

### 6. Validasi

- Setelah migration: cek lint Supabase.
- Manual: buat booking via website → cek WhatsApp manager + row di `notification_logs`. Kirim gambar via WhatsApp ke nomor Fonnte → cek super admin menerima. Kirim pesan keluhan → cek halaman Complaints muncul + manager dapat notif.

### File yang akan dibuat / diubah

Create:
- `supabase/migrations/{ts}_manager_notifications.sql`
- `src/services/manager-notifier.service.ts`
- `src/admin/modules/complaints/complaints.functions.ts`
- `src/admin/modules/complaints/complaints-view.tsx`
- `src/routes/admin/complaints.tsx`

Edit:
- `src/public/functions/public.functions.ts` (hook booking)
- `src/tools/booking.tool.ts` (hook booking)
- `src/admin/functions/calendar.functions.ts` (hook booking)
- `src/routes/api.fonnte.ts` dan/atau `src/webhook/parser.ts` (hook payment proof)
- `src/ai/multi-agent-orchestrator.ts` (hook complaint)
- `src/ai/router/intent-classifier.ts` (perluas intent komplain bila perlu)
- Sidebar admin layout (tambah menu Komplain)

Tidak menyentuh: alur RAG, simulator, smart-delay, booking state machine logic.
