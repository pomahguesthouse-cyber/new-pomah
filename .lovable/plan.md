## Ringkasan

Empat item P2 saling melengkapi: fast-path untuk kurangi p95, dead-letter agar percakapan gagal tidak hilang, dashboard supaya visible, dan regression test agar refactor berikutnya aman. Dibagi dalam 4 langkah kecil yang dapat diverifikasi terpisah.

## Langkah 1 — Latency fast-path intent lain (target: p95 < 8 s)

Kandidat intent lambat (berdasarkan pola sebelumnya): `faq`, `greeting`, `thanks`, `policy_question`, `location_question`, `contact_request`. Semua ini deterministik dan tidak butuh agent LLM.

- Tambah `fastPathDeterministicIntent(message, property)` di `src/services/wa-autoreply.service.ts` yang menangani:
  - `greeting` / `thanks` / `bye` → template properti (halo / terima kasih / sampai jumpa) + jam operasional bila relevan.
  - `location_question` → alamat + Google Maps link dari `properties`.
  - `contact_request` → nomor WA + email dari `properties`.
  - `policy_question` (check-in time, extra bed, cancellation) → kutip dari `properties` policy fields.
  - `faq` → cari di `chatbot_training_examples` via retrieval; jika confidence tinggi (>0.85), langsung jawab.
- Dipasang sebelum `buildContextualBookingInquiryReply` dan sebelum LLM chain, ditandai `orchResult.fastPath=true` supaya terlacak di routing-debug.
- Cache `properties` per 60 s in-memory untuk hindari round-trip DB setiap turn.

## Langkah 2 — Auto-retry + dead-letter → handoff ticket

`sendFailureFallbackToGuests` sudah kirim pesan "sistem sibuk". Yang belum: eskalasi ke admin agar percakapan mati tidak menumpuk.

- Extend `sendFailureFallbackToGuests` di `src/services/wa-autoreply.service.ts`:
  - Setelah fallback terkirim (atau claim `send_failed`), panggil `createHandoffTicket` dengan alasan `queue_terminal_failure`, snapshot last inbound, retry count, dan `last_error`.
  - Skip jika sudah ada handoff `open` untuk phone tersebut (idempotent).
- Cron re-drive di `src/routes/api.cron.process-wa-queue.ts`: tambahkan job re-queue untuk entry `status='pending'` yang locked > 5 menit (belum ada, sekarang cuma zombie cleanup 60 s untuk `processing`).
- Notif Telegram admin sudah ada via `notifyBotLoop` — kita reuse.

## Langkah 3 — Dashboard health realtime `/admin/health`

Halaman baru `src/routes/admin/health.tsx` + `src/admin/functions/health.functions.ts`:

- Metrik 5 menit terakhir & 24 jam:
  - Inbound / outbound count, delivery rate (`sent` vs `pending`+`failed`).
  - Zombie count (`wa_conversation_queue` status `failed` dgn `last_error` `zombie`).
  - Latency p50/p95 outbound (dari `created_at → sent_at`).
  - Distribusi intent (top 10 dari `whatsapp_messages.metadata->>intent`).
  - Open handoff tickets.
- Refresh via `useQuery` polling 60 s (tidak realtime channel; hindari biaya Realtime pgchanges yang tinggi).
- Link ke sidebar setelah "Routing Debug".

## Langkah 4 — Regression test-suite percakapan (skenario inti)

- `src/services/__tests__/wa-scenarios.test.ts` dengan Vitest, driver via `runAutoReplyForMessage` (mock Fonnte via `vi.mock('@/services/whatsapp.service')`).
- Skenario minimum (5):
  1. Greeting → template.
  2. Booking inquiry dengan tanggal → availability list.
  3. Extra bed policy → jawaban dinamis per room.
  4. Cancellation booking berbayar → tolak (bug fix sebelumnya).
  5. Payment proof text ("sudah transfer") → intent tag + eskalasi ke handoff.
- Fixture properti + rooms di-seed via factory in-file (bukan DB nyata) — pakai `createClient` mock ala `msw` untuk supabase.
- Tambah `bun run test:scenarios` di `package.json` scripts.

## Detail teknis

- Cache properti fast-path: `const propertyCache = new Map<string, {expires:number, value:Property}>()` scope module.
- Fast-path detector: kombinasi regex + fuzzy keyword; SEMUA fast-path harus set `orchResult.fastPath=true` + `intent` supaya routing-debug menampilkan.
- Handoff creation di dead-letter: pakai `createHandoffTicket({ phone, threadId, reason:'queue_terminal_failure', frustrationScore:'high', lastMessageId })`. Payload disimpan di `handoff_tickets.summary_json`.
- Cron re-drive: query `WHERE status='pending' AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')`, reset `locked_at=NULL` supaya bisa diklaim ulang.
- Dashboard queries: server function `getChatbotHealthSnapshot` dengan `supabaseAdmin`, guard `has_role admin`. Cache 15 s in-memory di server.
- Test-suite: fokus unit level pada `wa-autoreply.service` — tidak launch DB. Mock hanya boundary layer.

## Verifikasi

- Langkah 1: buka `/admin/routing-debug` setelah traffic → intent `greeting/location/contact` muncul dengan `fast_path=true`.
- Langkah 2: matikan Fonnte token sengaja di staging → cek `handoff_tickets` bertambah, tamu terima fallback message satu kali.
- Langkah 3: `/admin/health` menampilkan angka delivery rate & p95.
- Langkah 4: `bun run test:scenarios` hijau.

## Yang TIDAK dilakukan

- Tidak menambah channel Realtime (biaya + risiko subscription leak).
- Tidak mengubah intent classifier LLM (di luar scope P2).
- Tidak refactor queue engine — hanya menambah lapis re-drive.
