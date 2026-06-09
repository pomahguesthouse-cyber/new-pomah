# Audit & Perbaikan Gap State Machine Booking

## Ringkasan temuan audit

Sistem **sudah punya** state machine + draft persisten (`wa_booking_states`: state enum, BookingContext JSON, slots, last_topic, last_entity, expires_at 15 menit) + interruption handling + stuck-state monitor. **Namun ada gap nyata** di fase awal percakapan — persis skenario yang Anda contohkan ("Ada kamar tanggal 20?" → "Deluxe" → "2 orang" → "Budi"):

### Gap #1 — State `AWAITING_DATES` / `ROOM_SELECTED` / `AWAITING_DATES` di enum tapi tidak pernah di-set
Booking machine hanya mulai dari `AWAITING_NAME` ke atas. Fase tanya tanggal / tipe kamar / jumlah tamu 100% diserahkan ke LLM Front Office Agent, yang baru memanggil tool `start_booking_details` ketika **semua** parameter sudah lengkap. Jika tamu menjawab bertahap ("Deluxe" lalu "2 orang"), agent harus menyusun ulang dari history tiap turn — rentan halusinasi tanggal.

### Gap #2 — Slots hanya menyimpan `checkIn`/`checkOut`, tidak menyimpan `partialRoomType` / `partialAdults` / `partialChildren`
Akibatnya jawaban tunggal "Deluxe" (saat state masih IDLE) dilihat classifier sebagai pesan general → bisa salah route ke agen lain.

### Gap #3 — Classifier short-affirmative hanya menangani "ya/oke"
Tidak ada penanganan untuk reply pendek non-affirmatif yang jelas-jelas mengisi slot: angka jumlah orang ("2", "2 orang"), nama tipe kamar tunggal ("Deluxe", "Family"), atau tanggal lepas ("20 Juni") saat `last_topic ∈ {availability, pricing, booking}`.

### Gap #4 — Mismatch timeout
`last_topic` di-treat fresh selama state record belum auto-expire (15 menit), tapi `agreedDates` hanya di-inject jika `last_topic` ada. Setelah cron-cleanup, partial slots ikut hilang sementara booking_state mungkin masih hidup → tamu disuruh ulangi tanggal.

### Gap #5 — `last_required_field` tidak eksplisit
Sudah tersirat dari `state`, tapi tidak ada satu kolom yang bisa di-render di admin inbox untuk "tamu sedang ditanya: nomor HP". Akan membantu debugging & superadmin notification.

### Gap #6 — `PAYMENT_PENDING` & `COMPLETED` tidak punya transisi balik kalau tamu tiba-tiba minta ubah
State akan terjebak sampai 15 menit / sampai cancel keyword.

---

## Rencana perbaikan (fokus high-impact, minimal invasive)

### Step 1 — Perluas slots untuk partial booking data
File: `src/ai/state-machine/booking-machine.ts` + `src/ai/multi-agent-orchestrator.ts`

Tambah field opsional di slots: `partialRoomType` (string), `partialAdults` (number), `partialChildren` (number) di samping `checkIn`/`checkOut` yang sudah ada. Front Office agent akan menulis ke slots tiap kali ekstrak salah satu, sehingga turn berikut tidak perlu re-derive.

### Step 2 — Tool helper baru `update_booking_slots`
File baru: `src/tools/booking-slots.tool.ts` + daftar di `src/tools/registry.ts`

Tool ringan yang dipanggil agent ketika menangkap potongan data ("Deluxe" saja, "2 orang" saja). Menulis ke `wa_booking_states.slots` lewat RPC yang sudah ada (`update_booking_state` dipanggil dengan state IDLE + slots terbaru). Konsekuensi: jika tamu berikutnya bilang "ok pesan", agent sudah punya {checkIn, checkOut, roomType, adults} lengkap untuk memanggil `start_booking_details`.

### Step 3 — Perluas SHORT_AFFIRMATIVE classifier menjadi "slot-filling follow-up"
File: `src/ai/router/intent-classifier.ts`

Tambah deteksi: jika `lastTopic ∈ {availability, pricing, booking, room_facilities}` DAN pesan match salah satu pola:
- Angka pendek ("2", "3 orang", "2 dewasa 1 anak")
- Nama tipe kamar tunggal (cocokkan dengan daftar `ctx.rooms` dari context)
- Tanggal terisolasi ("20 Juni", "besok")

Maka inherit intent jadi `booking_inquiry` dengan confidence 0.8 (sama seperti SHORT_AFFIRMATIVE sekarang) supaya tidak salah-route ke agent lain.

### Step 4 — Decouple `agreedDates` dari `last_topic`
File: `src/ai/multi-agent-orchestrator.ts` (line 495-498)

Ubah guard: inject `agreedDates` jika slots berisi tanggal **DAN** state record belum kadaluarsa (cek `updated_at` vs 15 menit), tidak peduli `last_topic` masih ada. Hilangkan kelangkaan di Gap #4.

### Step 5 — Tambah kolom display `last_required_field` (computed)
File: `src/ai/state-machine/booking-machine.ts`

Fungsi derived helper `getRequiredField(state)` → string ("tanggal" | "tipe_kamar" | "jumlah_tamu" | "nama" | "email" | "nomor_hp" | "konfirmasi" | null). Dipakai oleh:
- Stuck-state monitor notification (superadmin lihat "macet di field nomor_hp")
- Admin WhatsApp inbox (optional badge, ditunda — bukan scope sekarang)

Tidak perlu migrasi DB, cukup derive di TS.

### Step 6 — Reset otomatis dari `COMPLETED` / `PAYMENT_PENDING` saat detect intent baru
File: `src/ai/state-machine/booking-machine.ts`

Tambah cek: di `PAYMENT_PENDING`, jika classifier intent = `booking_inquiry` dengan confidence tinggi dan pesan jelas pemesanan baru (mengandung tanggal/tipe), reset ke IDLE dan biarkan flow baru jalan. Hindari guest stuck.

---

## Yang TIDAK dikerjakan (tetap seperti sekarang)

- **Tidak menambah kolom DB baru** di `wa_booking_states` / `whatsapp_threads` — semua kebutuhan tertutup oleh `state` + `slots` JSON existing.
- **Tidak menambah state baru** di enum BookingState — `AWAITING_DATES` dan `ROOM_SELECTED` tetap unused (dead code akan dihapus di task lain, bukan sekarang).
- **Tidak mengubah Front Office agent prompt** — perbaikan deterministik di state/slots/classifier sudah cukup untuk skenario yang Anda sebutkan.
- **Visualisasi flowchart** — bukan scope (sudah Anda pilih audit, bukan dokumentasi).

---

## Verifikasi setelah implementasi

1. Jalankan AI Lab simulator dengan skenario: "ada kamar 20 desember?" → "deluxe" → "2 orang" → "ok pesan" → "Budi" → "budi@x.com" → "ya" → "ya konfirmasi". Pastikan tidak ada turn di mana agent re-ask data yang sudah disebut.
2. Cek `wa_booking_states.slots` setelah turn ke-3 berisi `{checkIn, checkOut, partialRoomType: "Deluxe", partialAdults: 2}`.
3. Cek classifier log: turn "deluxe" dan "2 orang" intent = `booking_inquiry` (bukan `general`).
4. Cron stuck-monitor: paksa state CONFIRMING_PHONE > 10 detik, pastikan notifikasi superadmin menyebut `last_required_field = "nomor_hp"`.
