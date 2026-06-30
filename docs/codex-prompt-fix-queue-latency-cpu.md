# Codex Prompt — Perbaiki latensi antrean WhatsApp (zombie_timeout akibat beban CPU Cloudflare Worker)

Salin seluruh blok di bawah ini ke Codex (agen sudah punya akses ke repo `new-pomah`).

---

## Konteks & gejala

Balasan chatbot WhatsApp sering terlambat ~1–5 menit padahal pembuatan balasannya cepat. Dari data antrean produksi (`wa_conversation_queue`, 2 hari terakhir, 84 entri):

- Entri SUKSES (no error): 43 entri, attempt 1,0, tunggu-pickup rata-rata 18,5 detik. Pemrosesan inti cepat (contoh nyata: balasan deterministik selesai 1,1 detik).
- Entri `zombie_timeout`: 41 entri (≈49%), attempt rata-rata 2,68, tunggu-pickup rata-rata 322 detik (~5,4 menit).
- Agregat: pemrosesan rata-rata 34 detik (maks 134), tunggu-pickup rata-rata 155 detik (maks 614).

Artinya hampir separuh job gagal diproses tuntas pada percobaan pertama, ditandai `zombie_timeout`, lalu di-retry berkali-kali — menumpuk backlog yang memperlambat SEMUA balasan (termasuk yang cepat).

## Akar masalah (sudah ditelusuri)

1. Worker pemroses dibunuh di tengah jalan karena beban CPU Cloudflare Worker, lalu lock kedaluwarsa → entri ditandai `zombie_timeout` → di-retry → dibunuh lagi. Lihat komentar eksplisit di `src/routes/api.cron.process-wa-queue.ts` (alasan `maxBatch` diturunkan dari 5 ke 2).
2. Drain TIDAK pakai advisory-lock global. `drainQueue` (`src/services/wa-autoreply.service.ts`) mengklaim entri paralel via `FOR UPDATE SKIP LOCKED` lalu memproses konkuren (`Promise.allSettled`), heartbeat 7 detik. Jadi serialisasi BUKAN penyebabnya.
3. Penyebab beban CPU ada di jalur fall-through (pesan percakapan yang tidak tertangkap fast-path) di `executeAutoreplyForPhone`. Langkah berat, berurutan, per entri:
   - SOP retrieval (`relevantSop`): `generateEmbedding` + RPC pgvector + potong 5.000 char.
   - Training retrieval (`findTrainingSignals`): `generateEmbedding` ×2 (positif+negatif) + 2–3 RPC vektor.
   - `runMultiAgentOrchestration`: klasifikasi → (kadang fallback LLM) → panggil LLM agen (`AI_TIMEOUT_MS=28000`) → tool call → sering panggil LLM lagi untuk format → parse JSON besar + rakit prompt besar (SOP 5KB + training + 20 pesan riwayat + katalog kamar), diulang sampai `AI_MAX_ATTEMPTS=2`.
   - Beban CPU (parse/stringify JSON besar, rakit prompt, array embedding 1536-dim) DIKALIKAN karena `drainQueue(origin, 2)` menjalankan 2 entri berat bersamaan dalam satu invokasi Worker.
4. Fast-path (FAQ, tonight price, guest-count, availability) SUDAH short-circuit sebelum langkah berat — itu sebabnya balasan transaksional cepat. Jangan rusak ini.

Catatan: `await fetch()` ke gateway LLM sebagian besar adalah tunggu I/O (tidak banyak makan CPU CF). Yang membakar CPU adalah kerja sinkron (JSON/string/array), bukan penantian jaringannya. Menaikkan TTL lock TIDAK menolong karena masalahnya worker DIBUNUH (heartbeat ikut mati), bukan sekadar lambat.

## Tujuan

Turunkan rasio `zombie_timeout` mendekati nol dan pangkas waktu tunggu-pickup, dengan mengurangi beban CPU per invokasi Worker — tanpa merusak jalur cepat maupun kualitas balasan percakapan.

## Yang harus dikerjakan (incremental, berdampak besar→kecil)

1. Batasi konkurensi kerja BERAT per invokasi Worker.
   - Saat ini satu invokasi `drainQueue(2)` bisa menjalankan 2 orchestration LLM sekaligus. Ubah agar entri yang akan menempuh jalur LLM berat tidak diproses 2 sekaligus dalam satu Worker.
   - Opsi: tetap klaim 2, tetapi serialkan bagian berat (orchestration) — proses fast-path konkuren, tetapi orchestration LLM satu per satu; ATAU turunkan batch khusus untuk beban berat; ATAU pisahkan "light drain" (fast-path saja) dari "heavy drain".
   - Pastikan tetap aman konkuren (klaim tetap `FOR UPDATE SKIP LOCKED`).

2. Pangkas biaya per-entri berat.
   - Turunkan `AI_MAX_ATTEMPTS` (2 → 1) dan/atau `AI_TIMEOUT_MS` (mis. 28000 → 18000) di `src/services/wa-autoreply.service.ts`. Pastikan masih cukup untuk satu pass agen + tool.
   - Buat SOP retrieval & training retrieval lebih murah/kondisional: lewati saat intent jelas tidak butuh (mis. greeting/smalltalk), kecilkan potongan SOP (5000 → mis. 2500 char) dan jumlah riwayat yang dikirim ke prompt (20 → mis. 10) bila tidak menurunkan kualitas.
   - Hindari panggilan embedding ganda bila bisa digabung.

3. Putus loop retry yang sia-sia.
   - Karena retry menjalankan kerja berat yang sama dan cenderung dibunuh lagi, pada percobaan ke-≥2 untuk satu entri, pertimbangkan strategi lebih murah (mis. kirim QUICK_ACK lebih awal lalu selesaikan via jalur ringan, atau langsung fallback yang sopan) daripada mengulang orchestration penuh berkali-kali.

4. (Rekomendasi arsitektural — usulkan, implementasikan bila layak) Pindahkan orchestration LLM berat keluar dari Cloudflare Worker request path (mis. durable consumer / runtime tanpa batas CPU ketat), sehingga job panjang tidak dibunuh. Bila terlalu besar untuk PR ini, tuliskan rencananya di deskripsi PR.

5. Setelah beban per-entri turun & zombie hilang, naikkan kembali `maxBatch` di `src/routes/api.cron.process-wa-queue.ts` secara bertahap untuk throughput, sambil memantau rasio zombie.

## Batasan

- JANGAN rusak fast-path deterministik (FAQ, tonight price, guest-count, availability) — semuanya harus tetap short-circuit sebelum SOP/training/LLM.
- Pertahankan kontrak klaim antrean (`FOR UPDATE SKIP LOCKED`), heartbeat, dan penyelesaian/komplesi entri yang sudah ada.
- Jangan turunkan kualitas balasan percakapan secara mencolok; bila memangkas konteks (SOP/riwayat), pastikan jawaban tetap akurat.
- Pertahankan kontrak output JSON balasan agen.

## Verifikasi

1. `bun run typecheck` (atau `npm run typecheck`) — bersih.
2. Uji beban ringan/simulasi: pastikan entri jalur-LLM tidak lagi memicu `zombie_timeout` pada kondisi normal, dan fast-path tetap < ~2 detik.
3. Tunjukkan, bila memungkinkan, perkiraan dampak: berapa langkah berat/biaya CPU berkurang per entri (attempt, ukuran prompt, jumlah panggilan jaringan).
4. Sertakan kueri SQL pemantauan agar admin bisa cek ulang setelah deploy, mis.:

   ```sql
   select coalesce(nullif(split_part(last_error,':',1),''),'(no error)') as err_kind,
          count(*) n, round(avg(attempt)::numeric,2) avg_attempt,
          round(avg(extract(epoch from (started_at-process_after)))::numeric,1) avg_wait_pickup_s
   from wa_conversation_queue
   where created_at > now() - interval '2 days'
   group by 1 order by n desc;
   ```

   Target: porsi `zombie_timeout` mendekati 0, `avg_wait_pickup_s` turun drastis.
5. Tunjukkan diff akhir dan ringkas perubahan per file beserta alasannya.

## Berkas relevan
- `src/routes/api.cron.process-wa-queue.ts` — pemicu drain & `maxBatch`.
- `src/services/wa-autoreply.service.ts` — `drainQueue`, `executeAutoreplyForPhone`, `AI_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`, retrieval SOP/training, urutan fast-path.
- `src/ai/multi-agent-orchestrator.ts` — orchestration LLM + tool calls.
- `src/services/training-retrieval.service.ts`, `src/ai/embedding.service.ts` — retrieval/embedding.
