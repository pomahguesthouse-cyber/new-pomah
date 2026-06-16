
# Web Chat Backup — Plan

Kanal cadangan resmi saat WhatsApp/Fonnte bermasalah. Konteks WA dipakai ulang, tamu bisa unggah bukti transfer, admin bisa ambil alih. WhatsApp/Fonnte tetap utuh.

## 1. Database (1 migration)

Tabel baru di `public`:

- **`webchat_threads`** — sesuai spesifikasi user; FK ke `bookings` & `whatsapp_threads` (`ON DELETE SET NULL`); index pada `last_message_at DESC` dan `status`.
- **`webchat_messages`** — FK ke `webchat_threads` (`ON DELETE CASCADE`); index `(thread_id, created_at)`.
- **`channel_status`** — satu baris per channel (`whatsapp_fonnte`, `webchat`); seeded `online`.

Kebijakan akses:

- `GRANT ALL` ke `service_role` (semua tulisan lewat server functions / `supabaseAdmin`).
- `GRANT SELECT` ke `anon` hanya untuk `channel_status` (homepage perlu baca status).
- Tidak ada akses anon ke threads/messages — semua via server functions.
- RLS aktif; policy admin read/write via `has_role(auth.uid(),'admin') OR is_staff(auth.uid())`.
- Trigger `update_updated_at_column()` untuk `updated_at`.

Storage:

- Bucket privat **`webchat-attachments`** (dibuat via `storage_create_bucket`); akses lewat signed URL dari server functions.

## 2. Server functions (`src/public/functions/webchat.functions.ts`)

Semua pakai `supabaseAdmin` (publik, tanpa login). Validasi Zod ketat, rate-limit per IP/phone via in-memory map (best-effort, non-critical):

1. `getChannelStatus()` → baris `whatsapp_fonnte` + `webchat`, plus flag `fallback_enabled`.
2. `startWebchatSession({ guestName, guestPhone, bookingCode? })`
   - Normalize phone ke `62…` (reuse helper di `wa-autoreply` / repo).
   - Cari `whatsapp_threads` dengan phone yang sama → link `whatsapp_thread_id` dan seed `context_summary` + `context_summary_json` dari `chat_summary` / `chat_summary_json`.
   - Resolve `bookingCode` → set `booking_id` + `booking_code`.
   - Reuse thread `status IN ('open','ai_active','waiting_admin')` untuk phone yang sama (tidak buat duplikat); else insert baru. Return thread + 50 pesan terakhir.
3. `sendWebchatMessage({ threadId, body })`
   - Insert pesan `sender_type='guest'`.
   - Jika `handoff_status='human'` dan `handoff_until > now()` → set `status='waiting_admin'`, kirim notifikasi ke super_admin (reuse `manager-notifier`), return tanpa AI.
   - Else: jalankan `runMultiAgentOrchestration` dengan system prompt khusus + konteks (booking, summary WA, pesan webchat terbaru). Simpan reply `sender_type='bot'`, update `last_message_at`, dan—bila tools menghasilkan summary baru—`context_summary_json`.
4. `uploadWebchatAttachment({ threadId, fileName, contentType, base64 })`
   - Upload ke bucket privat → signed URL 7 hari → insert message `attachment_url/type`.
   - Heuristik: kalau `contentType` image atau body mengandung "transfer/bukti" dan thread punya booking → panggil pipeline `payment-proof.service` (existing) + `notifyPaymentProof` super_admin.
5. `getWebchatMessages({ threadId, sinceId? })` → polling-friendly.
6. `closeWebchatThread({ threadId })` → set `status='closed'`.

Notifikasi baru ke super_admin saat sesi baru / handoff (reuse pola `notifyNewConversationSession`).

## 3. Health check (channel_status)

- `src/routes/api/cron.channel-healthcheck.ts` (cron 5 menit, ikut pola `apikey` di `pg_cron`):
  - Ping Fonnte `device`/`validate` endpoint pakai token properti.
  - Update `channel_status.whatsapp_fonnte` ke `online/degraded/offline`.
- Hook tambahan: di `src/routes/api.fonnte.ts` dan `src/services/whatsapp.service.ts` (saat `sendWhatsAppMessage` gagal 2× berturut-turut) → set `degraded`, dan `online` saat sukses lagi.

## 4. UI publik — `/chat` (TanStack route)

File rute:

- `src/routes/chat.tsx` (membaca search param `?booking=`).
- `src/routes/book/confirmation/$id/chat.tsx` (membungkus chat dengan ringkasan booking).

Komponen reusable di `src/public/components/webchat/`:

- `webchat-shell.tsx` — header sticky `Pomah Guesthouse — Web Chat Cadangan`, badge status (`WhatsApp Online/Degraded/Offline`, `Web Chat Active`, `Admin Online / AI Active`).
- `webchat-banner.tsx` — banner amber saat WA degraded/offline.
- `webchat-onboard-form.tsx` — Zod-validated: nama (3–60), phone (regex `08…|62…`), bookingCode opsional.
- `webchat-window.tsx` — list bubble (guest/bot/admin/system), timestamp `HH:MM`, typing indicator, auto-scroll, react-markdown untuk bot, quick-action chips.
- `webchat-composer.tsx` — textarea + tombol attach (pakai `uploadWebchatAttachment`).
- `webchat-booking-card.tsx` — ringkasan booking (room, tanggal, total, status, link invoice).

State: localStorage menyimpan `threadId` + identitas tamu agar refresh tetap nyambung. Polling `getWebchatMessages` setiap 5 detik (atau Supabase Realtime kalau lebih ringan; default polling untuk keep it simple).

Quick actions (chips kirim teks preset):
- "Cek ketersediaan kamar", "Lanjutkan booking", "Upload bukti transfer" (membuka file picker), "Tanya lokasi", "Hubungi admin" (set `status='waiting_admin'` via fn dedicated), "Cek booking saya".

Mobile-first: ikuti `responsive-layout-patterns` (grid `minmax(0,1fr)_auto` di header, `min-w-0`, `shrink-0`, `truncate`).

## 5. Integrasi entry-point publik

- **Homepage / booking pages**: tambahkan `<WebchatFallbackFab />` di `src/public/components/public-shell.tsx`. Fetch `getChannelStatus` (React Query, stale 30 dtk). Saat `whatsapp_fonnte != 'online' && fallback_enabled` → floating card kanan-bawah + tombol "Buka Web Chat" → `/chat`.
- **Invoice `/book/confirmation/:referenceCode`**: tombol "Chat via Web Chat Cadangan" → `/book/confirmation/$id/chat`.

## 6. AI prompt khusus

`src/ai/agents/webchat-fallback.prompt.ts` (string export) — dipakai sebagai `systemOverride` saat orchestrator dipanggil dari webchat:

- Identifikasi sebagai kanal fallback resmi.
- Wajib pakai `context_summary_json`, data booking, dan tidak menanyakan ulang info yang sudah ada.
- Prioritaskan panduan pembayaran kalau `payment_status='unpaid'`.
- Saat ada lampiran/transfer: konfirmasi + escalate ke finance/admin.
- Sensitif/tidak yakin → handoff (`status='waiting_admin'`).

`runMultiAgentOrchestration` dikasih param baru `channel: 'webchat'` agar orchestrator memilih prompt ini sebelum agent routing biasa (customer-care default, finance untuk bukti transfer).

## 7. Admin dashboard — `/admin/webchat`

- Route baru `src/routes/admin/webchat.tsx` + functions `src/admin/functions/webchat.functions.ts` (pakai `requireSupabaseAuth` + `has_role admin/staff`).
- List threads dengan filter tab: `open`, `waiting_admin`, `ai_active`, `closed`, plus filter "payment" (punya attachment payment_proof) dan "booking" (punya booking_id).
- Panel detail:
  - Data tamu, badge channel, link `whatsapp_threads` (kalau ada).
  - Card booking (reuse komponen invoice ringkas).
  - Context summary (read-only) + tombol Regenerate (panggil `generateSessionSummary` adapted untuk webchat).
  - Daftar pesan + reply box (multi-line).
  - Tombol: **Ambil alih** (set `handoff_status='human'`, `handoff_until=now()+30min`), **Serahkan ke AI** (`'ai'`, clear `handoff_until`), **Pause AI** (`'paused'`), **Tutup chat** (set `status='closed'`).
- Saat admin reply: insert message `sender_type='admin', sender_name=auth user`, set `handoff_status='human'`, `handoff_until=now()+30min`, `status='waiting_admin'→'open'`.
- Realtime invalidate via existing `useRealtimeInvalidate` (tabel `webchat_threads`, `webchat_messages`).
- Tambah item sidebar admin "Web Chat".

## 8. Notifikasi & logging

- Reuse `notifyNewConversationSession` & `notifyPaymentProof` (kasih `channel='webchat'` di metadata).
- Tambah handler `notifyWebchatHandoffRequested` ringan di `manager-notifier` (dedupe per thread per 10 menit).
- Logging mengikuti pola existing (`console.info`/`warn`).

## 9. Pengujian akhir

- Script `scripts/test-webchat-flow.ts`: simulasi start session (dengan & tanpa booking), kirim pesan, upload bukti, admin handoff, AI return, dan banner status saat `whatsapp_fonnte` di-set degraded.
- Manual smoke: `/chat`, `/chat?booking=PG-…`, `/book/confirmation/$id/chat`, dan banner di homepage saat status degraded.

## Hal yang TIDAK diubah

- `api.fonnte.ts`, `wa-autoreply.service.ts`, queue/worker, multi-agent orchestrator (hanya menerima param channel baru, default tetap `'whatsapp'`), booking-machine, dan halaman booking publik.

## Detail teknis penting

- Semua server fn di `src/public/functions/webchat.functions.ts` adalah **public** (tanpa auth) — validasi input ketat + rate-limit per phone, dan tidak pernah membocorkan kolom sensitif booking (`payment_account_number`, dsb.).
- `supabaseAdmin` di-import **di dalam handler** (`await import('@/integrations/supabase/client.server')`).
- Phone normalization & dedupe pakai helper yang sudah ada.
- Polling fallback default; Realtime opsional jika user minta.
- Channel `webchat` di tabel `notification_logs.event_type` cukup pakai `new_session`/`payment_proof` existing — tidak perlu ubah CHECK.

