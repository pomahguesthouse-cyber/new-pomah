
# Perbaikan Alur Chatbot Booking Pomah Guesthouse

Sebelum mulai mengubah ratusan baris di state machine dan webhook, saya ingin konfirmasi rencana di bawah karena cakupannya besar dan menyentuh logika pembayaran.

## Tujuan

Membuat chatbot WhatsApp Pomah:
- Menerima koreksi slot (tamu, tanggal, tipe, jumlah kamar, nama) tanpa minta "Ya/Batal" kaku.
- Menghitung extra bed Deluxe otomatis (kapasitas 2, max 3 dengan +Rp100.000/malam).
- Membatalkan draft & invoice ketika user menulis "Batal".
- Mendeteksi frustrasi dan menawarkan handoff ke admin.
- Tidak pernah menyimpan kalimat frustrasi sebagai nama.
- Menggabungkan pesan beruntun (debounce 5 detik) dan mengunci per nomor agar tidak ada dua balasan paralel.
- Hanya menerbitkan invoice setelah semua slot valid + konfirmasi final.

## Perubahan Utama

### 1. State machine baru (`src/ai/state-machine/booking-machine.ts`)
Ganti state lama menjadi:
```
IDLE
  → COLLECTING_DATES
  → SELECTING_ROOM
  → COLLECTING_GUEST_COUNT
  → VALIDATING_CAPACITY        (auto, hitung extra bed)
  → COLLECTING_NAME
  → COLLECTING_EMAIL
  → COLLECTING_PHONE
  → CONFIRMING_SUMMARY         (terima koreksi slot)
  → AWAITING_PAYMENT
CANCELLED
HUMAN_HANDOFF_REQUIRED
```

Tambah helper:
- `parseSlotCorrection(input)` → deteksi pola "jumlah tamu 5", "tanggal 20 des", "nama saya …", "ganti deluxe", dll. Dipakai di setiap state lanjut (terutama CONFIRMING_SUMMARY).
- `computeExtraBeds(roomType, rooms, guests)` → khusus Deluxe: `extra = max(0, guests - rooms*2)`, valid jika `extra ≤ rooms` (max 3/kamar). Harga `extra * nights * 100_000`.
- `validateName(input)` → tolak kalimat frustrasi & pertanyaan; reject jika cocok daftar `FRUSTRATION_PHRASES` atau berisi tanda tanya/diawali "saya pusing", dsb.

### 2. Extra bed Deluxe
- Saat `VALIDATING_CAPACITY`, jika `guests > rooms*2` dan `roomType=deluxe`:
  - Jika butuh extra ≤ jumlah kamar → tawarkan otomatis ("Untuk 2 kamar Deluxe & 5 tamu, kami tambahkan 1 extra bed (Rp100.000/malam). Total kamar Rp500.000 + extra bed Rp100.000 = **Rp600.000** untuk 1 malam. Lanjut?").
  - Jika melebihi (mis. 7 tamu di 2 kamar) → tawarkan tambah kamar.
- Simpan `extraBeds` & `extraBedTotal` di `wa_booking_states.context` dan masuk ke invoice.

### 3. Cancel handler
- Tambah `BOOKING_CANCEL_PATTERNS` (`/^batal/i`, `/cancel/i`, `/batalkan/i`).
- Saat terdeteksi di state manapun:
  - Set state `CANCELLED`.
  - Hapus draft & pending invoice (`bookings` status `draft|pending` untuk nomor itu → `cancelled`; invoice terkait → `void`).
  - Balas konfirmasi pembatalan + cara mulai ulang.
- Tidak buat invoice baru sampai user memulai ulang lewat alur normal.

### 4. Frustration detection (`src/services/frustration-detector.ts` baru)
- Daftar pola: `saya pusing`, `embuh`, `bukan email`, `ini benar\??`, `penipuan`, `tidak ai kan`, `apakah ini ai`, `ribet`, `bingung`, `gak ngerti`, dll.
- Fungsi `detectFrustration(text)` dipanggil di webhook sebelum routing AI.
- Jika hit:
  - Set state `HUMAN_HANDOFF_REQUIRED`.
  - Bot kirim ringkasan booking terakhir (tanggal, kamar, tamu, total estimasi) + verifikasi resmi: "Website resmi kami **pomahguesthouse.com**, invoice resmi otomatis terkirim setelah konfirmasi. Saya teruskan ke admin manusia 🙏."
  - Notify admin via `manager-notifier.service.ts`.

### 5. Trust/penipuan response
- Pola `penipuan|scam|tidak ai kan|benar gak|amankah` → balas template trust:
  - Domain resmi `pomahguesthouse.com`
  - Invoice resmi otomatis
  - Tombol/teks hubungi admin (nomor admin dari env)
- Tidak otomatis handoff jika cuma tanya (kecuali kata frustrasi).

### 6. Name validation
- `validateName(input)` cek:
  - panjang 2–60
  - bukan match `FRUSTRATION_PHRASES`
  - tidak mengandung `?`, `!`, kata `pusing|embuh|bingung|penipuan|email|nomor`
  - lulus `cleanNameCandidate` yang sudah ada
- Jika gagal: tanyakan ulang dengan sopan, jangan lanjut state.

### 7. Debounce 5 detik & lock per nomor
- Tambah `src/services/message-debouncer.service.ts`:
  - Gunakan tabel baru `wa_message_buffer` (phone, messages[], scheduled_at) atau in-memory + flush via cron 1-detik. **Karena worker stateless**, pakai tabel Supabase.
  - Saat webhook menerima pesan: insert ke buffer, set `scheduled_at = now()+5s`.
  - Cron `api.cron.process-wa-queue` (sudah ada) ambil buffer yang `scheduled_at <= now()` dan tidak ada pesan baru 5 detik terakhir → gabungkan jadi satu `combinedText` → proses.
- Lock: gunakan kolom `processing_lock` (timestamp) di `wa_booking_states`. Saat mulai memproses, `UPDATE ... SET processing_lock = now() WHERE phone=? AND (processing_lock IS NULL OR processing_lock < now()-30s)` — jika 0 row affected, skip (sudah ada worker lain).
- Release lock saat selesai/error.

### 8. Invoice gating
Di `confirming_summary`:
- Hanya transisi ke `AWAITING_PAYMENT` & buat invoice jika:
  - `checkIn`, `checkOut` valid & tersedia (`check_room_availability` RPC)
  - `roomType` & `rooms` valid
  - `guests` valid & kapasitas terpenuhi (dgn extra bed bila perlu)
  - `name` valid, `email` valid (regex), `phone` valid (E.164 ID)
  - Konfirmasi final `Ya|Lanjut|OK|Setuju` (regex eksak)
- Koreksi parsial (mis. "jumlah tamu 5 kak") → update slot, jalankan `VALIDATING_CAPACITY` ulang, tampilkan ringkasan baru, tetap di `CONFIRMING_SUMMARY`.

### 9. Front-office prompt
Update `src/ai/agents/front-office.agent.ts`:
- Instruksi eksplisit: terima koreksi slot, tawarkan extra bed Deluxe, jangan paksa Ya/Batal, sebut domain resmi saat ditanya trust.

## File yang Akan Diubah / Dibuat

Diubah:
- `src/ai/state-machine/booking-machine.ts` — state baru + parser koreksi + extra bed + name guard.
- `src/services/wa-autoreply.service.ts` — integrasi debounce, lock, cancel, frustration, trust template.
- `src/ai/agents/front-office.agent.ts` — prompt baru.
- `src/services/reply-postprocess.ts` — tambah rule trust.
- `src/routes/api.fonnte.ts` — masuk ke buffer/debouncer alih-alih proses langsung.
- `src/routes/api.cron.process-wa-queue.ts` — flush buffer + lock.
- `src/tools/executor.ts` — pastikan cancel hook membersihkan invoice.

Dibuat:
- `src/services/frustration-detector.ts`
- `src/services/message-debouncer.service.ts`
- `src/lib/booking-slot-parser.ts`
- Migration: tabel `wa_message_buffer` + kolom `processing_lock`, `extra_beds`, `extra_bed_total` di `wa_booking_states` (atau di context jsonb).

## Migrasi Database (perlu approval)

```sql
-- buffer pesan untuk debounce 5 detik
CREATE TABLE public.wa_message_buffer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  message text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.wa_message_buffer (phone, processed_at, scheduled_at);
GRANT ALL ON public.wa_message_buffer TO service_role;
ALTER TABLE public.wa_message_buffer ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.wa_message_buffer
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.wa_booking_states
  ADD COLUMN IF NOT EXISTS processing_lock timestamptz;
```

## Out of Scope

- Tidak mengubah skema invoice/payment provider.
- Tidak mengubah UI admin.
- Tidak menyentuh route lain di luar list di atas.

## Risiko

- Debounce 5 detik akan menambah latency balasan ~5 detik (sesuai permintaan).
- Lock berbasis DB; jika worker crash setelah ambil lock, lock kedaluwarsa 30 detik.
- Buffer butuh cron yang sudah ada (`api.cron.process-wa-queue`) berjalan minimal tiap 5–10 detik. Saat ini biasanya per menit — saya akan tambahkan endpoint yang aman dipanggil lebih sering, dan dokumentasikan agar pg_cron/Fonnte memanggil tiap 10 detik.

Setuju saya lanjut implementasi semuanya, atau ada bagian yang ingin dilewati/diprioritaskan dulu?
