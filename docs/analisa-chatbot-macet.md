# Laporan Analisa: Chatbot WhatsApp Sering Macet / Tidak Merespon

**Proyek:** new-pomah (Pomah Guesthouse)
**Tanggal:** 26 Juni 2026
**Lingkup:** Jalur balasan WhatsApp end-to-end — webhook → antrian → worker → orchestration AI → pengiriman Fonnte.
**Status:** Analisa kode (read-only). Belum ada perubahan kode.

---

## 1. Ringkasan Eksekutif

Chatbot "macet" bukan karena AI-nya lambat, melainkan karena **arsitektur penggerak antrian (queue driver) bertumpu pada satu titik kegagalan** dan beberapa jaring pengaman tidak aktif. Pesan tamu hampir selalu berhasil **tersimpan**, tetapi proses yang mengubah pesan tersimpan menjadi balasan terkirim bisa berhenti diam-diam tanpa alarm.

Tiga temuan paling berdampak:

1. Seluruh pengiriman balasan bergantung pada **pg_cron + pg_net** yang menembak URL **hardcoded**. Bila salah satu mati, bot diam total.
2. Fungsi pemulihan `recoverUnqueuedInboundMessages` adalah **dead code** — tidak pernah dipanggil, sehingga pesan yang gagal masuk antrian hilang tanpa balasan.
3. **Anggaran waktu AI sampai ~80 detik** rentan dipotong batas wall-time platform, memicu siklus "zombie" yang membuat tamu menunggu beberapa menit sebelum dapat balasan apa pun.

Perbaikan tercepat dengan dampak terbesar: tambah scheduler cadangan independen, aktifkan kembali pemulihan + quick-ack, dan ketatkan anggaran AI.

---

## 2. Arsitektur Jalur Balasan Saat Ini

```
Tamu kirim WA
   │
   ▼
Fonnte  ──webhook POST──►  /api/fonnte        (src/routes/api.fonnte.ts)
                              │  - verifikasi token
                              │  - parse + dedup
                              │  - simpan inbound
                              │  - enqueue ke wa_conversation_queue
                              ▼  return 200 (TIDAK menunggu AI)
                          wa_conversation_queue  (tabel antrian)
                              │
              ┌───────────────┴────────────────┐
              ▼                                 ▼
   Trigger AFTER INSERT              pg_cron tiap 2 detik
   t_process_wa_queue                drain-wa-queue
   → net.http_post                   → net.http_post
     /api/queue-worker                 /api/cron/process-wa-queue
              │                                 │
              └───────────────┬────────────────┘
                              ▼
                        drainQueue(origin, 1)     (wa-autoreply.service.ts)
                              │  - klaim 1 entry (FOR UPDATE SKIP LOCKED)
                              │  - executeAutoreplyForPhone()
                              │      • orchestration AI (≤40s × 2 attempt)
                              │      • kirim via Fonnte
                              ▼
                        Balasan terkirim ke tamu
```

Inti desain: webhook **hanya menaruh ke antrian** lalu langsung balas 200. Yang menjalankan AI dan mengirim balasan adalah penggerak terpisah (trigger pg_net dan pg_cron). Desain ini bagus untuk latensi webhook, tetapi memindahkan seluruh keandalan ke lapisan penggerak antrian — dan di situlah letak masalahnya.

---

## 3. Temuan Detail (diurut berdasarkan dampak)

### 🔴 Temuan #1 — Penggerak antrian adalah titik kegagalan tunggal dengan URL hardcoded

**Bukti:**

- `supabase/migrations/20260528120100_wa_queue_pg_cron_poll.sql` — pg_cron menjadwalkan POST tiap 2 detik ke URL hardcoded:
  ```sql
  PERFORM cron.schedule('drain-wa-queue', '2 seconds', $cron$
    SELECT net.http_post(
      url := 'https://pomahguesthouse.com/api/cron/process-wa-queue',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $cron$);
  ```
- `supabase/migrations/20260525220000_pg_net_queue_trigger.sql` — trigger INSERT juga hardcoded ke `https://pomahguesthouse.com/api/queue-worker`.

**Dampak:** Bila pg_cron berhenti (Supabase yang auto-pause pada tier hemat, restart project, ekstensi `pg_cron`/`pg_net` bermasalah) atau domain/deploy berubah, **tidak ada yang menguras antrian** → pesan menumpuk di `wa_conversation_queue` dan bot diam total. Karena URL ada di dalam SQL migrasi, setiap perubahan domain menuntut migrasi ulang dan mudah terlupa.

**Kenapa ini paling mungkin jadi penyebab "sering macet":** ini satu-satunya jalur yang andal (lihat Temuan #2 kenapa trigger INSERT tidak cukup). Tidak ada penggerak cadangan yang independen dari Supabase.

---

### 🔴 Temuan #2 — `net.http_post` fire-and-forget: tanpa retry, tanpa visibilitas

**Bukti:** Kedua penggerak memakai `net.http_post`, yang mengantre permintaan HTTP lalu tidak memeriksa responsnya. Komentar di `api.cron.process-wa-queue.ts` bahkan menyebut endpoint sengaja tanpa secret karena pg_net sulit membawa header rahasia.

**Dampak:** Kalau `/api/queue-worker` membalas 500 / timeout / TLS error, sinyal dari trigger `AFTER INSERT` **hilang** tanpa jejak. Penyelamat satu-satunya adalah cron 2 detik. Artinya keandalan balasan bergantung pada satu cron job, **tanpa alarm** bila pengirimannya gagal. Untuk audit:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

---

### 🔴 Temuan #3 — `recoverUnqueuedInboundMessages` tidak pernah dipanggil (dead code)

**Bukti:**

- Fungsi pemulihan terdefinisi lengkap di `src/services/wa-autoreply.service.ts` (mencari pesan inbound yang belum punya entry antrian / belum dibalas, lalu meng-enqueue ulang).
- Pencarian di seluruh `src/routes/**` **tidak menemukan** pemanggilnya. Cron `process-wa-queue` hanya memanggil `drainQueue` + `sendFailureFallbackToGuests`.
- Sementara di webhook (`api.fonnte.ts`), bila `queueUpsert` gagal, blok catch hanya mencatat `[Webhook] enqueue error` lalu **tetap return 200**:
  ```ts
  } catch (e) {
    console.error(`[Webhook] enqueue error: ${e} | ${logCtx}`);
  }
  return new Response("OK", { status: 200 });
  ```

**Dampak:** Jika enqueue gagal (error DB sesaat), pesan tamu sudah tersimpan tetapi **tidak pernah masuk antrian dan tidak ada balasan**. Jaring pengaman yang sudah Anda tulis untuk kasus ini tidak aktif karena tidak dijadwalkan.

---

### 🟠 Temuan #4 — Anggaran AI ~80 detik vs batas wall-time → siklus zombie

**Bukti:** `src/services/wa-autoreply.service.ts`:
```ts
const AI_TIMEOUT_MS = 40_000;   // per attempt
const AI_MAX_ATTEMPTS = 2;      // → total bisa ~80s + backoff + retrieval + tool calls
```
Heartbeat memperpanjang `lock_expires_at` tiap 30 detik. Bila platform (Cloudflare Workers) memotong request sebelum selesai, entry menjadi **zombie**; `wa_queue_cleanup_zombies` mereset ke `retrying`, dicoba lagi, bisa zombie lagi. Balasan fallback ("sistem sedang sibuk") baru dikirim **setelah** entry mencapai `status='failed'` (`sendFailureFallbackToGuests`).

**Dampak:** Tamu bisa menunggu beberapa menit melewati beberapa siklus zombie sebelum menerima balasan apa pun. Inilah pola "diam lalu telat balas".

---

### 🟠 Temuan #5 — Drain serial satu per satu (`batch=1`)

**Bukti:** Baik cron maupun worker memanggil `drainQueue(origin, 1)` — memproses **1 entry per invocation**.

**Dampak:** Saat beberapa tamu chat bersamaan atau satu balasan lama, antrian menumpuk dan latensi membengkak. Plafon throughput rendah (kira-kira 1 balasan / 2 detik dari jalur cron, plus dorongan dari trigger). Klaim `FOR UPDATE SKIP LOCKED` aman dari proses ganda, tetapi konkurensinya tidak dimanfaatkan.

---

### 🟡 Temuan #6 — Quick-ack mati secara default

**Bukti:**
```ts
const QUICK_ACK_ENABLED = process.env.WA_QUICK_ACK_ENABLED === "true";
const QUICK_ACK_AFTER_MS = 15_000;
```
**Dampak:** Selama pemrosesan yang bisa puluhan detik, tamu tidak menerima tanda apa pun. Walau sistem sedang bekerja, dari sisi tamu terlihat "didiamkan". Mengaktifkan ini tidak mempercepat AI, tetapi menghilangkan **persepsi** macet.

---

### 🟢 Catatan positif — bug yang sudah benar

- Bug `.catch()` pada thenable Supabase (dulu "membunuh setiap pesan masuk dengan 500") sudah diperbaiki di `resolveManagerByPhone`, dan pola berbahaya itu **tidak ditemukan lagi** di tempat lain.
- Dedup berlapis (in-memory + durable di DB), zombie-rescue untuk pesan `pending`, dan duplicate-send guard sudah dirancang matang — fondasi keandalannya baik; yang kurang adalah penggerak dan jaring pengaman di lapisan luar.

---

## 4. Tabel Ringkas

| # | Temuan | Tingkat | Gejala bagi tamu | Akar masalah |
|---|--------|---------|------------------|--------------|
| 1 | Penggerak antrian titik tunggal + URL hardcoded | Kritis | Bot diam total | Hanya pg_cron/pg_net Supabase yang menguras antrian |
| 2 | `net.http_post` tanpa retry/alarm | Kritis | Balasan hilang acak | Pengiriman trigger fire-and-forget |
| 3 | `recoverUnqueuedInboundMessages` dead code | Kritis | Pesan tertentu tak dibalas | Fungsi tidak dijadwalkan |
| 4 | Anggaran AI ~80s → zombie | Tinggi | Diam lalu telat balas | Timeout × attempt > wall-time |
| 5 | Drain serial `batch=1` | Tinggi | Lambat saat ramai | Throughput 1/2 detik |
| 6 | Quick-ack default mati | Sedang | Terasa didiamkan | Flag env tidak diaktifkan |

---

## 5. Rekomendasi Perbaikan (diurut prioritas)

**Cepat & berdampak besar (lakukan dulu):**

1. **Wire ulang `recoverUnqueuedInboundMessages`** ke cron yang sudah jalan (mis. di dalam `/api/cron/process-wa-queue`, dibatasi rate agar murah). Menutup Temuan #3.
2. **Aktifkan quick-ack** (`WA_QUICK_ACK_ENABLED=true`) agar tamu langsung dapat "Sebentar ya, saya cek dulu". Menutup persepsi macet (Temuan #6).
3. **Tambah scheduler cadangan independen** dari Supabase (Cloudflare Cron Triggers / GitHub Actions / Uptime-cron) yang memukul endpoint drain yang sama. Hilangkan ketergantungan titik tunggal (Temuan #1).

**Struktural (berikutnya):**

4. **Pindahkan URL penggerak ke konfigurasi/secret**, bukan hardcoded di SQL migrasi, agar ganti domain tidak memerlukan migrasi (Temuan #1).
5. **Turunkan `AI_TIMEOUT_MS`/`AI_MAX_ATTEMPTS`** atau pecah orchestration agar selesai jauh di bawah batas wall-time platform; kirim fallback lebih cepat saat attempt pertama gagal (Temuan #4).
6. **Pasang alarm** ketika laju zombie/fallback naik atau saat `cron.job_run_details` menunjukkan kegagalan, supaya "diam" terdeteksi sebelum tamu komplain (Temuan #2).
7. **Pertimbangkan `batch > 1`** atau interval cron lebih rapat dengan beberapa worker untuk lonjakan trafik (Temuan #5).

---

## 6. Cara Verifikasi Saat Insiden Terjadi

```sql
-- Apakah cron masih hidup & berhasil?
SELECT * FROM cron.job WHERE jobname = 'drain-wa-queue';
SELECT status, return_message, start_time
FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Antrian menumpuk?
SELECT status, count(*) FROM wa_conversation_queue GROUP BY status;

-- Entry yang macet / zombie:
SELECT id, phone, status, attempt, lock_expires_at, last_error, created_at
FROM wa_conversation_queue
WHERE status IN ('processing','retrying','failed')
ORDER BY created_at DESC LIMIT 20;
```
Jika `cron.job_run_details` kosong/gagal padahal antrian terisi → akar masalahnya Temuan #1/#2. Jika ada pesan inbound tanpa entry antrian sama sekali → Temuan #3.

---

*Disusun dari pembacaan langsung berkas: `src/routes/api.fonnte.ts`, `src/routes/api.queue-worker.ts`, `src/routes/api.cron.process-wa-queue.ts`, `src/services/wa-autoreply.service.ts`, `src/services/queue.service.ts`, `src/services/whatsapp.service.ts`, `src/webhook/parser.ts`, `src/webhook/deduplicator.ts`, dan migrasi pg_cron/pg_net terkait.*
