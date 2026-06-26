
# Fix: Chatbot kirim fallback "sistem sibuk" padahal worker masih jalan

## Akar masalah
Dari log `+62 812-1557-2927` dan AI Gateway (10 request terakhir semua `cancelled (HTTP 499)` di `google/gemini-2.5-flash`):
- Debounce/worker timeout di `wa-autoreply.service.ts` berakhir sebelum LLM selesai (8–10 detik).
- Saat timeout, sistem kirim fallback "Mohon maaf, sistem kami sedang sibuk" ke tamu, **lalu** worker LLM yang sebenarnya masih jalan diputus (→ `499` di Gateway).
- Tamu menerima fallback meskipun ada worker yang sebenarnya mampu menyelesaikan reply.

## Perubahan

### 1. Perpanjang debounce / max-wait window
File: `src/services/wa-autoreply.service.ts`
- Naikkan `MAX_WAIT_MS` (atau konstanta setara untuk `max_wait_exceeded`) dari ~10s ke **25s** supaya cukup untuk LLM + tool calls.
- Naikkan timeout abort signal yang dipasang ke `streamText`/`generateText` ke nilai yang sama, supaya worker tidak dipotong di tengah jalan.

### 2. Guard fallback berbasis queue lock
File: `src/services/wa-autoreply.service.ts` (fungsi `sendFailureFallbackToGuests` / path `max_wait_exceeded`)
- Sebelum kirim fallback "sistem sibuk", cek `wa_message_queue` untuk phone yang sama:
  - Jika ada entry dengan status `processing`/`locked` dan `locked_at` < 30 detik lalu → **skip fallback** (worker lain sedang menyelesaikan).
  - Jika semua entry sudah `done`/`failed`/`cancelled` → boleh kirim fallback.
- Tambah log terstruktur `fallback_skipped_worker_active` untuk audit.

### 3. Guard sama di booking-stuck-monitor
File: `src/routes/api.cron.booking-stuck-monitor.ts`
- Sebelum kirim alert "BOOKING FLOW MACET", tambahkan cek queue lock yang sama (selain cek handoff ticket yang sudah ada) → hindari double-notify saat worker sedang aktif.

### 4. Pertimbangan `max_attempts`
File: `src/services/wa-autoreply.service.ts`
- Untuk worker yang berakhir status `cancelled` karena timeout sebelumnya, naikkan `max_attempts` dari default ke **3** supaya retry otomatis kalau memang request pertama keburu di-cancel.

## Yang TIDAK diubah
- Tidak menurunkan `max_tool_turns` — biarkan kapasitas agen tetap.
- Tidak menyentuh prompt/model selection.
- Tidak mengubah handler `[FORM_SUBMITTED]` atau state machine.

## Verifikasi
1. Build + restart dev server.
2. Trigger pesan baru dari nomor tester, observasi:
   - Worker selesai dalam <25s tanpa fallback "sistem sibuk".
   - `ai_gateway_logs` tidak lagi menunjukkan rentetan `499` setiap 5 menit.
3. Cek tabel `wa_message_queue` setelah test → status worker `done`, bukan `cancelled`.

## Catatan
- Limit AI/Cloud Anda **bukan penyebab** masalah ini (sudah diverifikasi: 0 error 402/429 di log Gateway 7 hari terakhir). Top-up balance $3,72 masih aktif. Tetap pertimbangkan top-up untuk margin operasional, tapi tidak mendesak untuk fix bug ini.
