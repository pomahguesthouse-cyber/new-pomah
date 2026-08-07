# Audit Chatbot & Backend Pomah — 7 Agustus 2026

Ruang lingkup: seluruh backend (jalur balasan tamu, cron/background job, tools AI, admin server functions, RPC Supabase).
Basis kode: commit `bca70af0` (setelah "Hapus semua kode WPPConnect" — gateway sekarang hanya Evolution API).

Setiap temuan disertai lokasi `file:baris`, dampak nyata, dan usulan perbaikan. Prioritas dibaca dari atas.

---

> **Status perbaikan (7 Agu 2026).** S1, S2, S3, S4, B1, B2, B3, B6, P1, dan P3 sudah
> dikerjakan — lihat bagian [Log perbaikan](#6-log-perbaikan) di akhir dokumen.
> Yang masih terbuka: S5, B4, B5, B7, P2, P4, P5, P6.

## Ringkasan eksekutif

| # | Temuan | Severity | Dampak |
|---|--------|----------|--------|
| S1 | RPC invoice publik menerima wildcard `%` | 🔴 Kritis | Data tamu (nama, email, HP) + rekening properti bocor ke publik dengan 1 request |
| S2 | `update_payment_status` bisa dipanggil dari chat tamu | 🔴 Kritis | Tamu bisa menandai booking "lunas" tanpa bayar |
| S3 | Lookup `reference_code` pakai `ILIKE` tanpa cek kepemilikan | 🟠 Tinggi | Invoice/booking tamu lain bisa dikirim ke penanya |
| S4 | Webhook `/api/evolution` fail-open bila token kosong | 🟠 Tinggi | Siapa pun bisa menyuntik "pesan tamu" palsu |
| S5 | `/api/cron/process-wa-queue` tanpa autentikasi | 🟡 Sedang | Amplifikasi biaya + spam notifikasi admin |
| B1 | Error RPC ketersediaan tidak dicek → tamu dibilang "penuh" | 🔴 Kritis | Kehilangan booking, diam-diam, tanpa alert |
| B2 | `coerceDate` tidak naik tahun | 🟠 Tinggi | "3 Januari" dibaca sebagai tanggal yang sudah lewat |
| B3 | Anggaran waktu AI (18 s) < worst-case satu turn LLM (20,5 s) | 🟠 Tinggi | Fallback "sistem sedang lambat" muncul terstruktur |
| B4 | Dedup echo outbound lintas thread | 🟡 Sedang | Balasan manual admin bisa hilang dari inbox |
| P1 | pg_cron 2 detik + recovery scan penuh | 🟠 Tinggi | ±43.000 invokasi/hari + ratusan query/menit saat idle |
| P2 | `properties.select("*")` tiap pesan, tanpa cache | 🟡 Sedang | Latency + bandwidth di hot path |
| P3 | Dua jalur "nudge" yang sudah mati masih jalan | 🟡 Sedang | pg_net + subrequest terbuang tiap pesan |

---

## 1. Keamanan

### S1 — 🔴 RPC invoice publik menerima wildcard `%` (kebocoran PII)

**Lokasi**
- `supabase/migrations/20260626090000_public_booking_invoice_room_details.sql:27`
- fallback yang sama di `src/public/functions/public.functions.ts:692`

```sql
SELECT id INTO v_booking_uuid FROM public.bookings WHERE reference_code ILIKE p_id LIMIT 1;
```

Fungsi ini `SECURITY DEFINER` (bypass RLS) dan dipanggil oleh server function publik `getBookingInvoice` yang input-nya hanya `z.string().min(1)`.

**Dampak.** `p_id = "%"` cocok dengan SEMUA booking, `LIMIT 1` mengambil salah satunya, lalu RPC mengembalikan (baris 102–113 migrasi):

- `guest.full_name`, `guest.email`, `guest.phone`
- `property.bank`, `account_number`, `account_holder`
- nominal, tanggal menginap, status pembayaran

Jadi **satu request tanpa autentikasi** = data pribadi seorang tamu. Diulang dengan pola `PG-A%`, `PG-B%` dst. = enumerasi seluruh basis tamu. Ini bukan hipotesis: `%` dan `_` adalah wildcard resmi `ILIKE`.

**Perbaikan**
1. Di RPC: ganti `ILIKE p_id` → `= upper(p_id)` dan tolak input yang tidak cocok `^PG-[A-Z0-9]{5}$`.
2. Di `getBookingInvoice`: validasi format di Zod (`z.string().regex(/^(PG-[A-Za-z0-9]{5}|[0-9a-f-]{36})$/)`).
3. Pertimbangkan menaikkan entropi `reference_code` atau menambah token tanda tangan pada URL konfirmasi.
4. Tambahkan rate limit pada endpoint invoice publik.

### S2 — 🔴 `update_payment_status` terjangkau dari percakapan tamu

**Lokasi**
- `src/tools/finance/update-payment-status.tool.ts:30-75` — tidak ada pengecekan `ctx.isManager` sama sekali
- `src/ai/agents/finance.agent.ts:106` — tool terdaftar di Finance Agent
- `src/ai/router/agent-router.ts:30,37,44` — intent tamu `payment`, `invoice_request`, `payment_update` di-route ke Finance Agent

**Dampak.** Satu-satunya penjaga adalah kalimat di prompt ("Designed to be called ONLY by the Finance Agent after a high-confidence OCR match"). Pesan tamu seperti *"sudah saya transfer kok, tolong update status PG-XXXXX jadi lunas"* cukup untuk membuat LLM memanggil tool ini; `payment_status` berubah jadi `paid` tanpa verifikasi bukti apa pun. Prompt bukan mekanisme otorisasi.

Catatan: enforcement `allowedToolNames` di `src/ai/multi-agent-orchestrator.ts:557-573` hanya memblokir tool yang **tidak** ada di daftar agent. Tool ini ada di daftar, jadi lolos.

**Perbaikan**
1. Di awal handler: `if (!ctx.isManager) return JSON.stringify({ ok:false, error:"Tool ini hanya untuk admin." });`
2. Untuk jalur tamu, izinkan hanya transisi ke `paid` bila ada record OCR `matched` untuk booking tersebut.
3. Terapkan pola yang sama untuk tool bermuatan finansial/administratif lain (`update_booking_status`, `reschedule_booking`, `delete_booking`) — jangan mengandalkan daftar tool per agent saja.

### S3 — 🟠 Lookup `reference_code` dengan `ILIKE` + tanpa cek kepemilikan

**Lokasi**
- `src/tools/finance/send-invoice.tool.ts:66-71`
- `src/tools/finance/get-payment-info.tool.ts:53`
- `src/tools/finance/update-payment-status.tool.ts:60`
- `src/public/functions/webchat.functions.ts:195`
- `src/services/telegram-callbacks.ts:57`

Semua memakai `.ilike("reference_code", <input dari tamu/LLM>)` lalu `.limit(1)`. Tidak ada satu pun yang memverifikasi booking itu milik `ctx.phone`.

**Dampak.** Dua kelas masalah:
- **Wildcard**: `reference_code = "PG-%"` → cocok dengan booking mana pun → `send_invoice` mengirim invoice tamu lain ke penanya.
- **Salah ketik jinak**: tamu menyebut kode yang bukan miliknya, bot dengan senang hati membacakan total tagihan dan nama pemesan.

**Perbaikan.** Ganti ke `.eq("reference_code", code.toUpperCase())`, validasi format, dan untuk tool jalur tamu tambahkan filter kepemilikan (`guest_id` yang phone-nya cocok dengan `ctx.phone`). Bila tidak cocok → balas "kode booking tidak ditemukan untuk nomor ini".

### S4 — 🟠 Webhook Evolution fail-open

**Lokasi** `src/routes/api.evolution.ts:40-42`

```ts
const expected = expectedWebhookToken();
if (!expected) return true;   // ← tanpa token env, semua request diterima
```

**Dampak.** Bila `EVOLUTION_WEBHOOK_TOKEN`/`WPP_WEBHOOK_TOKEN` hilang dari environment (salah deploy, rotasi env, project clone), endpoint berubah jadi terbuka: siapa pun bisa POST payload berformat Evolution → pesan masuk palsu tersimpan, antrian terisi, LLM jalan, WhatsApp mengirim balasan ke nomor yang ditentukan penyerang. Endpoint `GET ?debug=1` juga ikut terbuka.

**Perbaikan.** Fail-closed: bila token tidak diset, tolak 503 dan log keras. Ini pilihan yang benar untuk endpoint yang memicu pengeluaran (LLM + WA API).

### S5 — 🟡 `/api/cron/process-wa-queue` tanpa autentikasi

**Lokasi** `src/routes/api.cron.process-wa-queue.ts:20-100` (handler `GET` dan `POST`, tanpa cek token)

Komentar di file menjelaskan alasannya (pg_cron sulit membawa secret tanpa Vault). Tapi konsekuensinya: siapa pun yang tahu URL bisa memanggil berulang → tiap panggilan menjalankan cleanup RPC, `recoverUnqueuedInboundMessages`, `drainQueue`, `sendFailureFallbackToGuests`, dan bisa memicu notifikasi Telegram zombie ke super admin.

**Perbaikan.** Simpan token di Supabase Vault dan kirim via header dari pg_cron, atau minimal: (a) tolak `GET` (crawler/prefetch), (b) rate-limit per IP, (c) cek header `User-Agent`/secret query sederhana. Prinsipnya sama dengan S4 — endpoint yang membelanjakan uang harus punya penjaga.

---

## 2. Bug logika

### B1 — 🔴 Error RPC ketersediaan diabaikan → tamu diberitahu "kamar penuh"

**Lokasi**
- `src/tools/availability.tool.ts:303-306` — `const { data: rows } = await client.rpc(...)`, field `error` tidak pernah dibaca
- `src/services/wa-autoreply/availability-formatters.ts:208-215` — kamar dengan `kamar_tersedia` null difilter habis → balasan "kamar kami sudah penuh"

**Dampak.** Kalau RPC `room_type_availability_detail` gagal (timeout, DB sibuk, pool habis), `rows` jadi `null`, semua tipe kamar kehilangan angka ketersediaan, dan formatter menyimpulkan **sold out**. Tamu ditolak untuk tanggal yang sebenarnya kosong, tidak ada log error, tidak ada alert. Ini kegagalan yang menghasilkan kerugian pendapatan langsung dan tak terlihat di dashboard.

Bandingkan dengan `src/tools/booking.tool.ts:314-323` yang menangani `availErr` dengan benar — jadi ini murni kelalaian, bukan keputusan desain.

**Perbaikan**
```ts
const { data: rows, error } = await client.rpc("room_type_availability_detail", {...});
if (error) {
  return JSON.stringify({
    ok: false,
    error: `Gagal cek ketersediaan: ${error.message}`,
    reply_to_guest: "Maaf Kak, sistem ketersediaan sedang tersendat. Boleh saya cek ulang sebentar lagi?",
  });
}
```
Plus: formatter harus membedakan `kamar_tersedia === null` (tidak diketahui) dari `0` (benar-benar penuh) — jangan pernah mengucapkan "penuh" dari data yang tidak diketahui.

### B2 — 🟠 `coerceDate` tidak menaikkan tahun

**Lokasi** `src/tools/availability.tool.ts:120-130`

```ts
const year = yRaw ? ... : today.slice(0, 4);   // selalu tahun berjalan
```

**Dampak.** LLM meneruskan "3 Januari" ke tool → 7 Agustus 2026 menghasilkan `2026-01-03`, tanggal yang sudah lewat. Tidak ada guard tanggal lampau di tool ini, jadi query jalan dan hasilnya membingungkan. `resolveYear` di `src/services/wa-autoreply/message-parsers.ts:48-55` sudah menangani ini dengan benar — logikanya tinggal dipakai ulang.

Tambahan: `makeIsoDate`-style validasi tidak ada di sini, sehingga "31 Februari" jadi string `2026-02-31` yang dikirim mentah ke Postgres.

### B3 — 🟠 Anggaran waktu AI lebih kecil dari worst-case satu turn LLM

**Lokasi**
- `src/services/wa-autoreply/runtime-policy.ts:26-30` — `AI_TIMEOUT_MS = 18_000`, `AI_TIMEOUT_LIGHT_MS = 14_000`
- `src/ai/multi-agent-orchestrator.ts:164-166` — `LLM_CALL_TIMEOUT_MS = 10_000`, `LLM_MAX_RETRIES = 1`
- `src/ai/multi-agent-orchestrator.ts:43` — `DEFAULT_MAX_TURNS = 3`

**Hitungannya.** Satu turn worst-case = 10 s (timeout) + 0,5 s (backoff) + 10 s (retry) = **20,5 s**, sudah melewati anggaran 18 s sebelum turn kedua dimulai. Percakapan availability normal butuh 2 turn (tool call → jawaban final) = hingga 20 s. Artinya begitu gateway LLM melambat sedikit saja, `AbortController` luar memutus orkestrasi → `reply` kosong → tamu menerima *"Maaf Kak, sistem sedang lambat…"*. Pesan itu terlihat di transkrip tamu +62 882-0082-77936.

**Perbaikan.** Buat anggaran berlapis dan konsisten:
- turun-kan `LLM_CALL_TIMEOUT_MS` ke ~7 s, atau
- hitung sisa anggaran secara dinamis: `perCallTimeout = min(10s, remainingBudget - reserve)`, dan matikan retry internal bila sisa anggaran < 2× timeout.
- Naikkan `AI_TIMEOUT_MS` ke ~22 s (masih di bawah `HANDLE_ONE_DEADLINE_MS = 26_000`) supaya 2 turn muat.

### B4 — 🟡 Dedup echo outbound tidak difilter per thread

**Lokasi** `src/routes/api.evolution.ts:138-156`

```ts
.eq("direction", "out")
.eq("body", displayMessage)
.gte("sent_at", twoMinsAgo)   // ← tanpa .eq("thread_id", ...)
```

**Dampak.** Balasan bot sangat berpola ("Mohon maaf Kak, untuk tanggal … sudah penuh"). Bila admin mengetik balasan manual dari HP ke tamu B dengan teks yang sama persis dengan pesan otomatis yang baru dikirim ke tamu A <2 menit lalu, pesan admin dianggap echo dan **tidak disimpan** — hilang dari inbox admin dan dari konteks LLM.

**Perbaikan.** Tambahkan `.eq("thread_id", threadId)` (resolve thread lebih dulu), dan idealnya andalkan `wpp_id` sebagai kunci utama dedup.

### B5 — 🟡 Thread lookup pada jalur outbound memakai nomor mentah

**Lokasi** `src/routes/api.evolution.ts:160-166` — `.eq("phone", customerPhone).maybeSingle()`

Jalur inbound memakai RPC `get_autoreply_context` yang paham `canonical_phone`/`external_chat_id`/`@lid`, tapi jalur outbound native tidak. Untuk kontak yang datang sebagai `@lid`, ini bisa membuat thread duplikat. `maybeSingle()` juga melempar error bila ada >1 baris untuk nomor yang sama — ditelan `catch` di baris 218 dan pesan admin hilang diam-diam.

**Perbaikan.** Pakai resolver identitas yang sama dengan jalur inbound; ganti `maybeSingle()` → `.limit(1)` + ambil elemen pertama.

### B6 — 🟡 Empat implementasi parser tanggal yang berbeda

**Lokasi**
1. `src/services/wa-autoreply/message-parsers.ts:57` — paling lengkap (baru diperbaiki 7 Agu 2026)
2. `src/tools/availability.tool.ts:94` — `coerceDate`, tanpa rollover tahun (B2)
3. `src/ai/state-machine/flexible-slot-extractor.ts:380-395` — regex sendiri, tanpa toleransi typo
4. `src/ai/multi-agent-orchestrator.ts:939` — `hasExplicitDateSignal`, duplikat ketiga dari deteksi sinyal tanggal

Insiden 7 Agustus 2026 ("masih ada 1 kamar untuk tanggal 8 Agustus 2026" dibalas dengan tanggal 18 September) terjadi persis karena satu dari parser ini gagal sementara yang lain tidak dikonsultasi. Selama ada empat sumber kebenaran, kelas bug ini akan terus muncul.

**Perbaikan.** Jadikan `message-parsers.ts` satu-satunya sumber (webchat sudah dimigrasikan 7 Agu 2026), lalu ekspor `resolveMonthName`/`mentionsExplicitDateSignal` untuk dipakai `availability.tool.ts` dan orchestrator.

### B7 — 🟡 `chatWithAI` publik tanpa rate limit

**Lokasi** `src/public/functions/public.functions.ts:1024`

Endpoint publik yang memanggil LLM dengan API key properti, tanpa captcha/rate limit/kuota per IP. Biaya token bisa dikuras oleh skrip sederhana.

**Perbaikan.** Rate limit per IP + per `threadId`, batasi jumlah pesan per sesi, dan pertimbangkan kuota harian yang dipantau.

---

## 3. Performance

### P1 — 🟠 pg_cron 2 detik menjalankan pekerjaan berat walau antrian kosong

**Lokasi**
- `supabase/migrations/20260703140000_wa_queue_pg_net_timeout_30s.sql:18-28` — `cron.schedule('drain-wa-queue', '2 seconds', ...)`
- `src/routes/api.cron.process-wa-queue.ts:24,59,72-76`

Tiap tick (43.200×/hari) menjalankan, tanpa memeriksa dulu apakah ada pekerjaan:
1. `wa_queue_cleanup_zombies` (RPC)
2. `recoverUnqueuedInboundMessages` — SELECT 20 pesan inbound terakhir + SELECT thread + hingga 3 query per baris
3. `drainQueue` → `wa_queue_claim_next` (RPC)
4. `sendFailureFallbackToGuests` — query tambahan

Saat idle pun ini bisa ratusan query per menit dan 43 ribu invokasi Worker per hari.

**Perbaikan**
1. Mulai handler dengan satu query murah: `SELECT 1 FROM wa_conversation_queue WHERE status IN ('pending','waiting','retrying') LIMIT 1` — kalau kosong, langsung return.
2. Pindahkan `recoverUnqueuedInboundMessages` dan `sendFailureFallbackToGuests` ke cron terpisah setiap 1–2 menit (fungsinya safety-net, bukan hot path).
3. Jangka menengah: ganti polling dengan Supabase Realtime / `LISTEN NOTIFY` atau trigger pg_net ke endpoint drain yang benar (lihat P3).

### P2 — 🟡 Konteks statis di-query ulang tiap pesan

**Lokasi** `src/services/wa-autoreply.service.ts:692-700`

```ts
(supabaseAdmin as any).from("properties").select("*").limit(1).maybeSingle(),
(supabasePublic as any).from("room_types").select(...).order("base_rate"),
```

Tabel `properties` berisi satu baris tapi ditarik **seluruh kolom** (termasuk `ai_lab_config`, konfigurasi homepage, dan `ai_api_key`) pada setiap pesan masuk. `room_types` juga nyaris tak pernah berubah. Pola cache TTL sudah ada di repo (`RAG_CFG_TTL_MS` di orchestrator, `TG_TOKEN_TTL_MS` di manager-notifier) — tinggal diterapkan.

**Perbaikan.** Cache module-scope TTL 60 detik untuk keduanya, dan ganti `select("*")` dengan daftar kolom eksplisit. Menarik `ai_api_key` ke memori pada setiap request juga memperluas permukaan kebocoran log.

### P3 — 🟡 Dua jalur "nudge" yang sudah dimatikan masih menghabiskan resource

**Lokasi**
- `src/routes/api.evolution.ts:62-84, 348-355` — `scheduleQueueNudge` tidur hingga 15 detik di dalam `waitUntil`, lalu POST ke `/api/queue-worker`
- `src/routes/api.queue-worker.ts:29-40` — endpoint itu mengembalikan `202 {disabled:true}` untuk semua panggilan non-manual
- `supabase/migrations/20260525220000_pg_net_queue_trigger.sql:26-33` — trigger DB `t_process_wa_queue` juga masih mem-POST ke endpoint yang sama pada setiap INSERT antrian

Jadi tiap pesan masuk membakar: 1 subrequest Worker + hingga 15 detik masa hidup `waitUntil` + 1 panggilan pg_net — semuanya ke endpoint yang sengaja tidak melakukan apa-apa. Karena `202` dianggap `res.ok`, tidak ada satu pun warning yang muncul di log.

**Perbaikan.** Hapus `scheduleQueueNudge` dari webhook dan `DROP TRIGGER t_process_wa_queue` (+ trigger update-nya). Bila ingin latency lebih rendah dari tick 2 detik, arahkan trigger ke `/api/cron/process-wa-queue` yang memang aktif.

### P4 — 🟡 Notifikasi WhatsApp ke super admin untuk **setiap** pesan tamu

**Lokasi** `src/routes/api.evolution.ts:281-295` → `src/services/manager-notifier.service.ts:1337-1380`

Tiap pesan masuk memicu: 2 query (token + daftar manager), penulisan baris dedupe, lalu kiriman WhatsApp per super admin dengan retry. Pada jam ramai ini menggandakan trafik keluar ke gateway (risiko rate-limit dari WhatsApp) dan menenggelamkan admin.

**Perbaikan.** Kirim notifikasi hanya bila relevan: AI mati untuk thread itu, handoff aktif, atau tamu baru pertama kali. Selain itu, kumpulkan jadi digest tiap 10–15 menit.

### P5 — 🟡 `get_autoreply_context` dipanggil dua kali per pesan

**Lokasi** `src/routes/api.evolution.ts:298` dan `src/services/wa-autoreply.service.ts:502`

RPC yang sama (dengan agregasi pesan + summary) dieksekusi di webhook lalu diulang di worker beberapa detik kemudian.

**Perbaikan.** Simpan `thread_id`/`canonical_phone` hasil webhook ke baris antrian, dan biarkan worker memanggil versi ringan yang hanya mengambil apa yang belum ada.

### P6 — 🟡 Banyak round-trip untuk anti-duplikasi

Jalur balasan melakukan read-then-write berlapis: cek ack (2 SELECT), cek dedup entry + body (2 SELECT), atomic claim (1 SELECT), lalu update metadata (1–2 UPDATE) — `src/services/wa-autoreply.service.ts:1210-1256, 1599-1688, 1735-1769`.

**Perbaikan.** Ganti dengan constraint DB: partial unique index pada `(thread_id, (metadata->>'queue_entry_id'))` untuk baris non-ack. Satu INSERT yang gagal dengan `23505` menggantikan seluruh koreografi baca-tulis, sekaligus menghapus race yang tersisa.

---

## 4. Yang sudah baik (jangan diubah tanpa alasan kuat)

- **Antrian berbasis DB** dengan `FOR UPDATE SKIP LOCKED`, heartbeat, zombie cleanup, dan retry — desainnya tepat untuk Cloudflare Workers yang bisa dievict.
- **Persist-before-send** pada outbound message + zombie rescue: pola yang benar untuk menjamin at-least-once tanpa pesan ganda.
- **Constraint anti-overlap di DB** (`booking_rooms_no_overlap`) plus penanganan `23P01` di `booking.tool.ts:610` — double booking dicegah di lapisan yang benar, bukan hanya di aplikasi.
- **Auth admin konsisten**: seluruh server function admin memakai `.middleware([requireSupabaseAuth])`; hanya endpoint baca publik yang sengaja terbuka (`getSeoLandingPageBySlug`, `listActivePublicEvents`).
- **Enforcement tool tak dikenal** di orchestrator (`multi-agent-orchestrator.ts:557-573`) — tinggal diperluas ke otorisasi peran (S2).
- **Regression test** untuk parser & formatter (`scripts/test-*.ts`) sudah jadi kebiasaan yang sehat.

---

## 5. Urutan pengerjaan yang disarankan

**Minggu ini (kritis, effort kecil)**
1. S1 — perbaiki RPC + validasi format kode booking (±30 menit, menutup kebocoran PII)
2. S2 — tambahkan gate `isManager` pada tool finansial (±30 menit)
3. B1 — cek `error` RPC ketersediaan + bedakan null vs 0 (±1 jam, langsung menyelamatkan booking)
4. S4 — ubah webhook jadi fail-closed (±10 menit)

**Berikutnya (dampak besar, effort sedang)**
5. S3 — `eq` + cek kepemilikan untuk semua lookup `reference_code`
6. B3 — selaraskan anggaran waktu LLM berlapis
7. P3 — hapus dua jalur nudge mati
8. P1 — gerbang murah di cron + pisahkan job safety-net

**Perbaikan struktural**
9. B6 — satukan parser tanggal ke `message-parsers.ts`
10. P2/P5/P6 — cache konteks statis, hilangkan RPC ganda, ganti koreografi dedup dengan constraint DB
11. Pecah `executeAutoreplyForPhone` (1.500 baris, 12 fast-path berurutan) menjadi rantai handler yang bisa diuji satuan

---

---

## 6. Log perbaikan

### 7 Agustus 2026 — S1, S2, B1, S4 selesai

| Temuan | Perubahan |
|--------|-----------|
| **S1** | Migrasi `supabase/migrations/20260807090000_secure_public_booking_invoice_lookup.sql`: `reference_code ILIKE p_id` → `upper(reference_code) = upper(p_id)` + tolak input di luar `^[A-Z0-9-]{3,20}$`, plus index `idx_bookings_reference_code_upper`. Sisi TS: `getBookingInvoice` memvalidasi bentuk id di Zod dan fallback tabelnya memakai `.eq()` (bukan `.ilike()`). |
| **S2** | `update-payment-status.tool.ts`: kanal managerial bebas; kanal tamu HANYA lolos bila ada `ocr_match.status="matched"` untuk kode booking yang sama di thread nomor tersebut (≤24 jam) **dan** booking itu terdaftar atas nomor tersebut. Kode booking divalidasi bentuknya, lookup memakai `.eq()`. Deskripsi tool di `finance.agent.ts` diperbarui supaya LLM tidak menabrak gate ini berulang. |
| **B1** | `availability.tool.ts` memeriksa `error` dari `room_type_availability_detail` dan mengembalikan `availability_unknown: true` + `reply_to_guest` alih-alih data kosong. `availability-formatters.ts` menambah `unknownAvailabilityReply()`: status tidak diketahui (RPC gagal **atau** semua tipe kamar tanpa angka) tidak lagi diterjemahkan jadi "kamar sudah penuh". Salinan RPC di `webchat.functions.ts` ikut diperbaiki. |
| **S4** | `api.evolution.ts`: `isAuthorized()` → `authorize()` yang fail-closed — token env kosong sekarang menghasilkan `503` + `console.error`, bukan menerima semua request. Berlaku untuk `POST` dan endpoint `GET ?debug=1`. |

**Test.** `scripts/test-security-hardening.ts` (baru, terdaftar di `bun run test:security` dan rantai `test:wa-refactor`) menutup: payload wildcard ditolak, fail-closed 503/403/200, status tak diketahui tidak pernah berbunyi "penuh" sementara stok 0 asli tetap dilaporkan penuh, dan tamu tanpa bukti OCR tidak bisa menandai lunas (tanpa satu pun `UPDATE` ke `bookings`). Seluruh suite lain tetap hijau kecuali `test-returning-guest-memory.ts` yang **sudah merah sebelum perubahan ini** (sapaan tamu lama, tidak berkaitan).

**Yang perlu dipastikan saat deploy.** S4 membuat webhook menolak semua request bila `EVOLUTION_WEBHOOK_TOKEN` (atau `WPP_WEBHOOK_TOKEN`) tidak ada di environment produksi. Pastikan variabel itu benar-benar terset di Lovable/Cloudflare sebelum rilis, dan URL webhook di manager Evolution masih membawa `?token=…` yang sama.

### 7 Agustus 2026 (lanjutan) — S3, B3, P3, P1 selesai

| Temuan | Perubahan |
|--------|-----------|
| **S3** | Helper baru `src/lib/booking-code.ts`: `normalizeBookingCode()` (validasi bentuk + huruf besar), `invalidBookingCodeError()`, dan `bookingBelongsToPhone()` (cek kepemilikan lewat `guests!inner(phone)` + `phoneVariants`). Dipakai di `send-invoice`, `get-payment-info`, `update-payment-status`, `telegram-callbacks`, dan `startWebchatSession` — semuanya kini `.eq()` bukan `.ilike()`. Tool jalur tamu (`send_invoice`, `get_payment_info`) menolak kode yang bukan milik nomor penelepon; manajer dikecualikan. Bonus: `get_payment_info` tidak lagi mempercayai argumen `guest_phone` dari LLM di kanal tamu — nomor percakapan yang berlaku, sehingga tamu tidak bisa mengintip booking nomor lain. |
| **B3** | `AI_TIMEOUT_MS` 18 s → 22 s, `AI_TIMEOUT_LIGHT_MS` 14 s → 16 s. Anggaran juga dipangkas dinamis agar tidak menabrak `HANDLE_ONE_DEADLINE_MS`: `min(budget, 26s − elapsed − 3s cadangan kirim)`. `MultiAgentInput` menerima `deadlineAt`; `resolveCallTimeoutMs()` menghitung timeout tiap panggilan LLM dari sisa anggaran (batas atas 10 s, lantai 3,5 s, cadangan 1,5 s), dan retry internal dilewati bila sisa waktu tidak cukup untuk satu panggilan penuh. AbortController luar sekarang jadi jaring pengaman, bukan pemutus rutin. |
| **P3** | `scheduleQueueNudge` dihapus dari webhook (hemat 1 subrequest + hingga 15 detik `waitUntil` per pesan). Migrasi `20260807093000_drop_dead_queue_worker_triggers.sql` menghapus trigger `t_process_wa_queue`, `t_process_wa_queue_update`, dan fungsi `trigger_process_wa_queue()` yang mem-POST ke endpoint ber-status `disabled`. |
| **P1** | `/api/cron/process-wa-queue` dibuka dengan gerbang murah: satu `SELECT id … WHERE status IN (pending,waiting,processing,retrying) LIMIT 1` (memakai partial index `idx_wa_cq_phone_active`); bila kosong → langsung `{idle:true}` tanpa cleanup/scan/claim. Pekerjaan safety-net dipindah ke route baru `/api/cron/wa-queue-safety-net` + migrasi `20260807094000_wa_queue_safety_net_cron.sql` (pg_cron tiap 1 menit). Drain tetap 2 detik untuk menjaga latency balasan. |

**Test.** `scripts/test-security-hardening.ts` diperluas: normalisasi/penolakan kode booking (termasuk `PG-%`, `PG_9J6Y2`, non-string), tiga hasil `bookingBelongsToPhone` (true/false/null saat error), `send_invoice` menolak kode milik tamu lain dan menolak wildcard, serta invariant anggaran B3 (timeout mengecil mengikuti sisa waktu; retry tidak pernah melewati anggaran). Seluruh suite hijau kecuali `test-returning-guest-memory.ts` yang sudah merah sebelumnya.

**Catatan deploy tambahan.**
- Route baru sudah didaftarkan manual di `src/routeTree.gen.ts` mengikuti pola generator, jadi `bun run typecheck` bersih; `vite build` akan meregenerasi file itu seperti biasa.
- Dua migrasi baru perlu dijalankan. Setelah itu verifikasi: `SELECT jobname, schedule FROM cron.job WHERE jobname IN ('drain-wa-queue','wa-queue-safety-net');` dan pastikan trigger `t_process_wa_queue*` sudah tidak ada.
- Kalau kode booking legacy ada yang tersimpan huruf kecil, `bookingBelongsToPhone` dan lookup `.eq()` di tool memakai huruf besar — cek dengan `SELECT count(*) FROM bookings WHERE reference_code <> upper(reference_code);` sebelum rilis.

### 7 Agustus 2026 (lanjutan) — B6 selesai, B2 ikut tertutup

Modul kanonik baru **`src/lib/id-date.ts`** menampung seluruh primitif tanggal Bahasa Indonesia: `ID_MONTHS`, `resolveMonthName()` (dengan toleransi typo + daftar kata non-bulan), `makeIsoDate()`, `resolveYear()`, `resolveIdDate()`, dan `mentionsExplicitDateSignal()`. Keempat implementasi lama sekarang menunjuk ke sana:

| Jalur | Sebelum | Sesudah |
|-------|---------|---------|
| `services/wa-autoreply/message-parsers.ts` | definisi lokal (paling lengkap) | impor dari lib, lalu re-export `resolveMonthName` + `mentionsExplicitDateSignal` supaya pemanggil lama tidak berubah |
| `tools/availability.tool.ts` | `ID_MONTHS` + `coerceDate` sendiri | `resolveIdDate()` / `makeIsoDate()` |
| `ai/state-machine/flexible-slot-extractor.ts` | `BULAN_MAP` + alternation bulan di regex | `resolveIdDate()`; regex tinggal `(\d{1,2})\s+([a-z]{3,})` dan keputusan "ini bulan atau bukan" diserahkan ke lib |
| `ai/multi-agent-orchestrator.ts` | regex `hasExplicitDateSignal` versi sendiri | `mentionsExplicitDateSignal()` (+ tetap mengenali "minggu depan/weekend") |

**B2 ikut tertutup.** Karena `coerceDate` dan `parseIndonesianDate` sekarang memakai `resolveYear()`, "3 Januari" yang diucapkan bulan Agustus menghasilkan **2027**-01-03, bukan tanggal lampau di tahun berjalan. Keduanya juga lewat `makeIsoDate()`, jadi "31 Februari" ditolak alih-alih dikirim mentah sebagai string `2026-02-31` ke Postgres.

**Test.** `scripts/test-date-parsing-consistency.ts` (baru, `bun run test:date-consistency`) menjalankan input yang sama melalui keempat jalur dan menuntut hasil identik — termasuk kalimat insiden asli, typo "sepember", rollover Januari, dan penolakan pola kuantitas ("2 malam", "3 kamar", "4 dewasa") di semua jalur. Sweep tambahan atas 60+ kata Indonesia yang lazim muncul setelah angka (termasuk seluruh nama hari) memastikan fuzzy-match tidak menghasilkan bulan palsu.

---

*Disusun 7 Agustus 2026. Semua nomor baris merujuk ke commit `bca70af0`.*
