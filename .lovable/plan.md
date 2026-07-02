# Auto WhatsApp Summary — Tanpa Ganggu Kecepatan Bot

## Kondisi saat ini
- Kolom "WhatsApp Summary (teks)" = `whatsapp_threads.chat_summary`.
- Sudah ada 2 jalur pengisian:
  1. **Seed deterministik** (regex, tanpa LLM) via `buildSeedSummary` / `seedMissingThreadSummary` — instan.
  2. **LLM summary** via tombol manual "Create Summary" (`regenerateStructuredSummary` → `generateWhatsAppSessionSummary`, model `gemini-2.5-flash`, ±2–4 dtk).
- Belum ada trigger otomatis LLM. Kalau dipanggil di jalur balasan, akan menambah 2–4 dtk ke latency chatbot → dilarang.

## Tujuan
Kolom summary selalu terisi dan up-to-date otomatis, tanpa menambah 1 ms pun ke path balasan WhatsApp.

## Strategi (fire-and-forget, 3 lapis)

### Lapis 1 — Seed instan saat pesan pertama masuk (sinkron, murah)
Di `wa-autoreply.service.ts` setelah pesan inbound tersimpan: jika `summaryIsMissing(thread)` → panggil `seedMissingThreadSummary` inline (hanya regex, <5 ms). Ini menjamin kolom tidak pernah kosong meski LLM belum jalan.

### Lapis 2 — LLM refresh async via `ctx.waitUntil` (tidak menahan reply)
- Setelah worker selesai mengirim balasan (`drainQueue` → setelah `sendFonnte` OK), jadwalkan LLM summary lewat `ctx.waitUntil(regenerateThreadSummary(...))`.
- Debounce per thread: hanya jalan kalau `chat_summary_updated_at` > 90 dtk yang lalu **atau** `chat_summary_version` naik ≥ 5 pesan sejak update terakhir. Cek murah lewat kolom yang sudah ada (`chat_summary_version`, `chat_summary_updated_at`).
- Karena `waitUntil` lepas dari response, latency balasan ke tamu tidak terpengaruh; Worker CPU time terpisah dari request-time budget.

### Lapis 3 — Cron backfill 5 menitan (safety net)
- Tambah endpoint `POST /api/public/cron.wa-summary-refresh` yang men-scan `whatsapp_threads` dengan `last_message_at > chat_summary_updated_at + 3 min` (limit 20/putaran) dan menjalankan `regenerateThreadSummary`.
- Dijadwalkan via pg_cron 5 menit sekali. Ini menutupi thread yang balasannya lewat human takeover, worker crash, atau `waitUntil` di-evict.

## UI (halaman `/admin/whatsapp`)
- Tetap tampilkan tombol **Create Summary** untuk override manual.
- Tambah badge kecil di kartu summary: "Auto • diperbarui X menit lalu" bila `source ∈ { llm, auto_seed, backfill_auto }`, agar admin tahu ini otomatis.
- Realtime sudah invalidate thread — tidak ada perubahan tambahan yang diperlukan.

## Detail teknis
- File yang disentuh:
  - `src/services/wa-autoreply.service.ts` — tambah seed inline + `waitUntil(regenerateThreadSummary)` bertingkat debounce.
  - `src/services/whatsapp-summary.service.ts` — export `shouldRefreshSummary(thread, { minAgeMs, minVersionDelta })`.
  - `src/routes/api.public.cron.wa-summary-refresh.ts` — cron handler baru (auth via `internal-route-auth` seperti cron lain).
  - `supabase/migrations/*` — pg_cron schedule 5 menit.
  - `src/routes/admin/whatsapp.tsx` — badge "Auto • …" (kosmetik).
- Model: pakai `resolvePropertyAiConfig` (fallback `gemini-2.5-flash`, murah + cepat).
- Guard biaya: skip regenerasi kalau `messages < 3` atau tidak ada pesan baru sejak update terakhir.

## Dampak pada kecepatan chatbot
- Path reply tidak menunggu LLM summary sama sekali (`waitUntil` async).
- Seed sinkron hanya regex string murni — <5 ms, aman.
- Cron di endpoint publik terpisah, tidak berbagi CPU budget dengan queue-worker.

## Verifikasi
1. Simulator: kirim 3 pesan, cek kolom `chat_summary` terisi seed segera; setelah ±10 dtk terisi versi LLM.
2. Ukur latency balasan sebelum/sesudah — harus tidak berubah.
3. Matikan cron sementara, biarkan waitUntil di-evict paksa, pastikan cron mengisi ulang di siklus berikutnya.
