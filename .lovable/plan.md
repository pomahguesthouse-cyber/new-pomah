# Plan: Form Booking Temporary (Hybrid dengan Chatbot)

## Tujuan
Memindahkan pengisian data pemesan dari slot-filling chat ke form web sekali pakai. Chatbot tetap memimpin tahap discovery (rekomendasi kamar, cek availability), lalu menyerahkan pengumpulan data final ke form. Setelah submit, chatbot otomatis kirim summary + invoice (gating "Ya/Lanjut" tetap berlaku).

## Alur End-to-End

```text
[Tamu chat WA]
   │  intent booking, tanya kamar, dst.
   ▼
[Chatbot bantu pilih kamar + tanggal awal]
   │  setelah tamu konfirmasi kamar X tgl Y-Z
   ▼
[Chatbot generate booking_form_token]
   │  kirim link: https://pomah.../booking/form/{token}
   ▼
[Tamu buka form di browser]
   │  field tanggal & room sudah prefilled dari context chat
   │  tamu lengkapi: nama, jumlah tamu, extra bed, email (opsional), catatan
   ▼
[Submit] ──► POST /api/public/booking-form/{token}
   │  validasi token (belum expired, belum dipakai, phone match)
   │  validasi availability + stop-sell realtime
   │  simpan ke wa_booking_states context
   ▼
[Webhook trigger ke wa-autoreply]
   │  chatbot kirim summary + invoice + minta konfirmasi "Ya/Lanjut"
   ▼
[Tamu reply "Ya"] → booking dibuat, alur PAYMENT_PENDING normal
```

## Komponen Teknis

### 1. Database
Tabel baru `booking_form_tokens`:
- `token` (text unique, 32 char random)
- `phone` (text, FK logical ke whatsapp_threads)
- `thread_id` (uuid)
- `prefill_data` (jsonb: room_type_id, check_in, check_out, guest_count default)
- `submitted_data` (jsonb, null sampai submit)
- `status` (enum: pending | submitted | expired | cancelled)
- `expires_at` (timestamp, default now() + 30 menit)
- `submitted_at`, `created_at`, `updated_at`
- RLS: hanya service_role write; anon SELECT dengan filter `token = ?` (untuk publik buka form)

### 2. Server Routes (public)
- `GET /api/public/booking-form/$token` → return prefill data + room types tersedia (cek stop-sell untuk tanggal prefilled). 404 kalau expired/submitted.
- `POST /api/public/booking-form/$token` → validasi Zod, cek availability ulang, simpan `submitted_data`, set status `submitted`, panggil `triggerChatbotAfterFormSubmit(phone, data)`.

### 3. Route Form Publik
`src/routes/booking.form.$token.tsx`:
- Reuse komponen dari `BookingDialog` di `rooms.$slug.tsx` (DateField, room picker, extra bed dynamic).
- Header: "Pomah Guesthouse — Lengkapi data pemesanan" + ringkasan kamar prefilled.
- Field: tanggal (editable, default prefill), kamar (editable dropdown), jumlah tamu, extra bed (kapasitas dinamis via `resolveRoomExtraBedPolicy`), nama, email (opsional, label "boleh dikosongkan"), catatan/request.
- Submit button → POST, lalu redirect ke `/booking/form/$token/done` (halaman terima kasih: "Silakan kembali ke WhatsApp, kami sudah kirim ringkasan").
- Mobile-first (mayoritas tamu buka dari WA).

### 4. Integrasi Chatbot
Di `src/ai/state-machine/booking-machine.ts`:
- State baru `AWAITING_FORM_SUBMIT` (transisi dari `COLLECTING_DATA` saat kamar + tanggal sudah terkumpul).
- Tool baru `generateBookingFormTool`:
  - Buat token, simpan prefill (room_type_id, check_in, check_out, guest_count) dari context.
  - Return URL form ke agent → agent kirim pesan: *"Untuk mempercepat, silakan isi data pemesanan di form ini: {url}. Form berlaku 30 menit."*
- Listener form submit di `wa-autoreply.service.ts`:
  - Fungsi `triggerChatbotAfterFormSubmit` enqueue ke `wa_conversation_queue` dengan body sintetis `[FORM_SUBMITTED]` + payload.
  - Saat queue diproses, state machine load `submitted_data`, transisi ke `CONFIRMING_BOOKING`, panggil `buildBookingSummaryAsync`, kirim summary + minta "Ya/Lanjut".

### 5. Fallback
Cron job baru `api.cron.booking-form-reminder.ts` (atau extend stuck monitor):
- Tiap 5 menit, scan token `pending` umur > 10 menit → kirim reminder WA: *"Form masih menunggu. Mau lanjut isi atau saya bantu via chat saja?"*
- Token umur > 30 menit → mark `expired`, transisi state machine balik ke `COLLECTING_DATA` (mode chat), kirim: *"Form kedaluwarsa. Lanjut via chat — boleh sebutkan nama lengkap?"*. Slot-filling chat lama dipakai kembali.

### 6. Admin
Tambah tab di `/admin/handoff` atau dashboard baru `/admin/booking-forms`:
- List token (status, phone, expires_at, link copy).
- Kalau perlu, admin bisa generate manual form untuk tamu.

### 7. Security
- Token = `crypto.randomBytes(24).toString('base64url')`.
- Rate limit POST per token (1x submit).
- Validasi Zod ketat: tanggal future, room_type_id ada di DB, guest_count ≤ kapasitas+extra bed.
- Tidak expose phone number di response GET (hanya inisial last-4).
- Tidak ada PII di URL.

## Yang TIDAK Berubah
- Gating invoice (tetap minta "Ya/Lanjut" sebelum kirim invoice).
- Frustration detection & human handoff.
- Persist-then-send, dedup guard, atomic claim semua path fallback.
- Slot-filling chat lama (jadi fallback, bukan dihapus).
- Daily rate / extra bed dinamis dari `room_types`.

## Rollout Bertahap
1. **Migrasi DB + route form publik + GET/POST endpoint** (form bisa dites manual via admin).
2. **Tool `generateBookingFormTool` + state `AWAITING_FORM_SUBMIT`** di-gate via feature flag (`enable_booking_form` di `properties`), default off.
3. **Listener submit → trigger chatbot summary**.
4. **Cron reminder + expiry fallback ke chat**.
5. **Aktifkan flag** untuk 1 property dulu, monitor frustration score & conversion 1 minggu, baru rollout penuh.

## Pertimbangan
- **Pro**: parsing NLU berkurang drastis, validasi realtime, frustration turun, mobile UX jelas.
- **Kontra**: tamu yang malas klik link tetap perlu fallback chat — sudah dicover oleh expiry → balik ke `COLLECTING_DATA`.
- **Effort**: ~3-4 hari developer (DB + 2 route + integrasi state machine + cron + admin + QA).

## Catatan
Tidak mengubah landing page Pomah (memori core terjaga). Tidak menyentuh schema `auth/storage`. Semua field/komentar berbahasa Indonesia sesuai konvensi proyek.
