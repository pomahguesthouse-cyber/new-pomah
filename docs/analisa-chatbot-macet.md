# Laporan Analisa: Chatbot WhatsApp Sering Macet / Tidak Merespon

**Proyek:** new-pomah (Pomah Guesthouse)
**Tanggal analisa awal:** 26 Juni 2026
**Terakhir diperbarui:** 27 Juni 2026
**Lingkup:** Jalur balasan WhatsApp end-to-end — webhook → antrian → worker → orchestration AI → pengiriman Fonnte.
**Status:** Sebagian besar temuan SUDAH DIPERBAIKI di kode. Dokumen ini diperbarui agar tidak menyesatkan.

> **⚠️ Catatan revisi 27 Juni 2026**
> Verifikasi ulang terhadap kode produksi menunjukkan **empat dari enam temuan
> (#3, #4, #5, #6) sudah ditutup**. Temuan #2 sudah ditutup sebagian (alarm
> zombie aktif). Hanya **Temuan #1** yang masih relevan, dan itu pun sedang
> ditutup dengan scheduler cadangan (GitHub Actions). Tiap temuan di bawah
> kini diawali blok status. Selain itu ditemukan **satu masalah baru di luar
> kode** — auto-reply manual di panel Fonnte (lihat Temuan #7).

---

## 1. Ringkasan Eksekutif

> **Status terkini (27 Juni 2026):** Dari tiga temuan paling berdampak yang
> disebut di bawah, **dua sudah selesai** — `recoverUnqueuedInboundMessages`
> kini dipanggil di cron, dan anggaran AI sudah diketatkan ke 28s/attempt.
> Yang **masih terbuka hanya ketergantungan pada satu penggerak antrian
> (pg_cron)**, dan itu sedang ditutup dengan scheduler cadangan independen.
> Teks di paragraf ini dipertahankan sebagai catatan historis analisa awal.

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

> **Status (27 Juni 2026): ⚠️ MASIH TERBUKA — sedang ditutup.** pg_cron masih
> satu-satunya penggerak yang berjalan rutin, dan URL-nya masih hardcoded di
> SQL migrasi. **Perbaikan yang sedang berjalan:** scheduler cadangan
> independen lewat GitHub Actions (`.github/workflows/wa-queue-keepalive.yml`)
> yang memukul `/api/cron/process-wa-queue` tiap 5 menit — bukan pengganti
> pg_cron 2 detik, tapi jaring penyelamat bila Supabase pause/pg_cron mati.
> Rekomendasi #4 (pindahkan URL ke konfigurasi) belum dikerjakan.

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

> **Status (27 Juni 2026): 🟡 SEBAGIAN DITUTUP.** Sifat fire-and-forget
> `net.http_post` masih ada, tapi visibilitas sudah ditambah: cron
> `process-wa-queue` kini memanggil `notifyZombieTimeout` (lihat
> `src/routes/api.cron.process-wa-queue.ts`) yang mengirim alarm ke super
> admin saat entry zombie di-reset. Yang belum: alarm khusus saat
> `cron.job_run_details` sendiri gagal (lihat Rekomendasi #6).

**Bukti:** Kedua penggerak memakai `net.http_post`, yang mengantre permintaan HTTP lalu tidak memeriksa responsnya. Komentar di `api.cron.process-wa-queue.ts` bahkan menyebut endpoint sengaja tanpa secret karena pg_net sulit membawa header rahasia.

**Dampak:** Kalau `/api/queue-worker` membalas 500 / timeout / TLS error, sinyal dari trigger `AFTER INSERT` **hilang** tanpa jejak. Penyelamat satu-satunya adalah cron 2 detik. Artinya keandalan balasan bergantung pada satu cron job, **tanpa alarm** bila pengirimannya gagal. Untuk audit:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

---

### 🔴 Temuan #3 — `recoverUnqueuedInboundMessages` tidak pernah dipanggil (dead code)

> **Status (27 Juni 2026): ✅ SUDAH DITUTUP.** Fungsi ini kini dipanggil di
> `src/routes/api.cron.process-wa-queue.ts` (sekitar baris 59):
> `await recoverUnqueuedInboundMessages({ lookbackMinutes: 30, limit: 20 })`,
> dibungkus try/catch agar non-fatal. Pesan inbound yang gagal masuk antrian
> kini di-enqueue ulang oleh cron. Bukti di bawah dipertahankan sebagai
> catatan historis (kondisi saat analisa awal).

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

> **Status (27 Juni 2026): ✅ SUDAH DITUTUP.** `AI_TIMEOUT_MS` kini **28.000 ms**
> (bukan 40.000) dan `AI_MAX_ATTEMPTS` tetap 2 → total ~56s, sudah di bawah
> batas wall-time Cloudflare Worker. Tiap attempt memakai `AbortController`
> dengan `setTimeout(() => controller.abort(), AI_TIMEOUT_MS)`. Angka "~80s"
> di bawah adalah kondisi historis saat analisa awal.

**Bukti:** `src/services/wa-autoreply.service.ts`:
```ts
const AI_TIMEOUT_MS = 40_000;   // per attempt
const AI_MAX_ATTEMPTS = 2;      // → total bisa ~80s + backoff + retrieval + tool calls
```
Heartbeat memperpanjang `lock_expires_at` tiap 30 detik. Bila platform (Cloudflare Workers) memotong request sebelum selesai, entry menjadi **zombie**; `wa_queue_cleanup_zombies` mereset ke `retrying`, dicoba lagi, bisa zombie lagi. Balasan fallback ("sistem sedang sibuk") baru dikirim **setelah** entry mencapai `status='failed'` (`sendFailureFallbackToGuests`).

**Dampak:** Tamu bisa menunggu beberapa menit melewati beberapa siklus zombie sebelum menerima balasan apa pun. Inilah pola "diam lalu telat balas".

---

### 🟠 Temuan #5 — Drain serial satu per satu (`batch=1`)

> **Status (27 Juni 2026): ✅ SUDAH DITUTUP.** Cron kini memanggil
> `drainQueue(origin, 2, request.signal)` — memproses 2 entry per tick secara
> paralel via `Promise.allSettled`, dan `request.signal` menghentikan
> pekerjaan baru bila platform memutus koneksi di tengah jalan. Batch sengaja
> ditahan di 2 (bukan lebih tinggi) karena orchestrator multi-agent + tool
> call memakan CPU budget Worker; 2/tick × cron 2s = 60/menit, masih jauh di
> atas throughput nyata. `batch=1` di bawah adalah kondisi historis.

**Bukti:** Baik cron maupun worker memanggil `drainQueue(origin, 1)` — memproses **1 entry per invocation**.

**Dampak:** Saat beberapa tamu chat bersamaan atau satu balasan lama, antrian menumpuk dan latensi membengkak. Plafon throughput rendah (kira-kira 1 balasan / 2 detik dari jalur cron, plus dorongan dari trigger). Klaim `FOR UPDATE SKIP LOCKED` aman dari proses ganda, tetapi konkurensinya tidak dimanfaatkan.

---

### 🟡 Temuan #6 — Quick-ack mati secara default

> **Status (27 Juni 2026): ✅ SUDAH DITUTUP.** Flag kini
> `QUICK_ACK_ENABLED = process.env.WA_QUICK_ACK_ENABLED !== "false"` — artinya
> **aktif secara default** (hanya mati bila env di-set persis `"false"`). Juga
> `QUICK_ACK_AFTER_MS` diturunkan ke 6.000 ms (dari 15.000), jadi tamu lebih
> cepat menerima tanda "Sebentar Kak, saya cekkan dulu ya." Kondisi di bawah
> (default mati, 15s) adalah historis.

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

### 🔴 Temuan #7 — Auto-reply manual di Fonnte mengarah ke domain salah ketik (DI LUAR KODE)

> **Status (27 Juni 2026): ⚠️ DITEMUKAN dari screenshot produksi.** Sedang
> ditangani di panel Fonnte (bukan di kode).

**Bukti:** Pada percakapan tamu nyata (cek 7-9 Agustus), pesan balasan instan
pertama berbunyi *"Mohon Maaf Chat Whatsapp Kami sedang Bermasalah silahkan
menghunakan fitur webchat di http://pomahgusethouse.com/chat"*. Frasa ini —
termasuk typo "menghunakan" dan domain **`pomahgusethouse.com`** (huruf `e`
dan `t` tertukar) — **tidak ditemukan di seluruh codebase maupun di seed
database**. Domain yang benar (`pomahguesthouse.com`) tersebar di banyak file;
versi salah ketik tidak ada di mana pun.

**Dampak:** Pesan ini hampir pasti berasal dari **fitur auto-reply manual di
panel Fonnte/WhatsApp**, bukan dari chatbot. Tamu diarahkan ke URL yang rusak
("Gak bisa dibuka ka") sebelum chatbot sempat memproses permintaan. Karena di
luar kode, perbaikannya juga di luar kode: matikan/perbaiki template auto-reply
di panel Fonnte. Tidak ada jalur kode yang bisa menghasilkan atau menambal ini.

---

## 4. Tabel Ringkas

| # | Temuan | Tingkat | Status (27 Jun 2026) | Akar masalah |
|---|--------|---------|----------------------|--------------|
| 1 | Penggerak antrian titik tunggal + URL hardcoded | Kritis | ⚠️ Terbuka — scheduler cadangan ditambahkan | Hanya pg_cron/pg_net Supabase yang menguras antrian |
| 2 | `net.http_post` tanpa retry/alarm | Kritis | 🟡 Sebagian — alarm zombie aktif | Pengiriman trigger fire-and-forget |
| 3 | `recoverUnqueuedInboundMessages` dead code | Kritis | ✅ Ditutup — dipanggil di cron | (dulu: fungsi tidak dijadwalkan) |
| 4 | Anggaran AI ~80s → zombie | Tinggi | ✅ Ditutup — timeout 28s × 2 | (dulu: timeout × attempt > wall-time) |
| 5 | Drain serial `batch=1` | Tinggi | ✅ Ditutup — batch=2 paralel | (dulu: throughput 1/2 detik) |
| 6 | Quick-ack default mati | Sedang | ✅ Ditutup — aktif default, 6s | (dulu: flag env tidak diaktifkan) |
| 7 | Auto-reply Fonnte → domain salah ketik | Kritis | ⚠️ Di luar kode — tangani di panel Fonnte | Template auto-reply manual, bukan chatbot |

---

## 5. Rekomendasi Perbaikan (diurut prioritas)

> **Status terkini (27 Juni 2026)** ditandai di tiap butir. Yang tersisa
> dikerjakan tinggal #3 (scheduler cadangan) dan, opsional, #4 dan #6.

**Cepat & berdampak besar (lakukan dulu):**

1. ✅ **SELESAI.** Wire ulang `recoverUnqueuedInboundMessages` ke cron — sudah
   dipanggil di `/api/cron/process-wa-queue`. Menutup Temuan #3.
2. ✅ **SELESAI.** Aktifkan quick-ack — kini aktif secara default
   (`WA_QUICK_ACK_ENABLED !== "false"`), delay 6s. Menutup Temuan #6.
3. ⚠️ **SEDANG DIKERJAKAN.** Tambah scheduler cadangan independen dari Supabase
   (GitHub Actions `wa-queue-keepalive.yml`, tiap 5 menit) yang memukul
   endpoint drain yang sama. Menutup Temuan #1. Alternatif lebih rapat:
   Cloudflare Cron Triggers (`triggers.crons` di `wrangler.jsonc`).

**Struktural (berikutnya):**

4. ⬜ **BELUM.** Pindahkan URL penggerak ke konfigurasi/secret, bukan hardcoded
   di SQL migrasi, agar ganti domain tidak memerlukan migrasi (Temuan #1).
5. ✅ **SELESAI.** Turunkan `AI_TIMEOUT_MS` → kini 28s/attempt × 2 = ~56s, di
   bawah batas wall-time (Temuan #4).
6. ⬜ **BELUM.** Pasang alarm saat `cron.job_run_details` menunjukkan kegagalan
   (alarm zombie sudah ada; alarm kegagalan cron belum) (Temuan #2).
7. ✅ **SELESAI (sebagian).** `batch > 1` — kini `batch=2` paralel. Naikkan
   lebih lanjut hanya bila CPU budget Worker memungkinkan (Temuan #5).
8. ⬜ **DI LUAR KODE.** Matikan/perbaiki auto-reply manual di panel Fonnte yang
   mengarah ke domain salah ketik (Temuan #7).

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
