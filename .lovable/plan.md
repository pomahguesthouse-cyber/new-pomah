
# Upgrade Context Summary WhatsApp — Structured JSON

Tujuan: ganti chat_summary text-only menjadi pasangan `short_summary` (text) + `chat_summary_json` (structured fields) supaya bot dapat menjawab follow-up pendek ("kalau deluxe?", "berapa totalnya?") tanpa mengarang konteks, dengan UI admin untuk inspeksi/regenerate/clear.

## 1. Migration database

File: `supabase/migrations/<ts>_chat_summary_json.sql`

- `ALTER TABLE public.whatsapp_threads`
  - `ADD COLUMN chat_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `ADD COLUMN chat_summary_version integer NOT NULL DEFAULT 1`
- `CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)` — clone versi terbaru (lihat `20260525130000_restore_fonnte_autoreply_context.sql`), tambahkan field di SELECT thread: `chat_summary_json`, `chat_summary_version`, dan kembalikan di JSON output bersama `chat_summary` + `chat_summary_updated_at` + 30 messages terakhir (yang sudah ada). Tidak mengubah signature.
- GRANT EXECUTE sama seperti versi sebelumnya (service_role).

## 2. Service summarizer (`src/services/wa-autoreply.service.ts`)

- Update `generateSessionSummary` jadi mengembalikan:
  ```ts
  type StructuredSummary = {
    short_summary: string;
    guest_name: string | null;
    last_topic: "pricing"|"availability"|"facility"|"booking"|"payment"|"complaint"|"location"|"general"|null;
    room_type: string | null;
    check_in: string | null;       // ISO YYYY-MM-DD
    check_out: string | null;
    guest_count: number | null;
    booking_status: "none"|"pending"|"confirmed"|"cancelled"|"checked_in"|"checked_out"|null;
    payment_status: "unpaid"|"down_payment"|"paid"|"pay_at_hotel"|null;
    complaint_active: boolean;
    unresolved_question: string | null;
    needs_human: boolean;
    handoff_reason: string | null;
  };
  ```
- Prompt LLM eksplisit: "Jangan mengarang. Field yang tidak disebutkan tamu/admin → null. JSON valid saja, tanpa markdown." Gunakan Lovable AI Gateway (model yang sama dipakai sekarang) dengan `response_format: { type: "json_object" }` jika didukung; jika tidak, parse manual + ekstrak blok JSON.
- Validasi:
  - parse JSON → kalau gagal: log `summary failed invalid JSON`, fallback ke flow lama (simpan text mentah ke `chat_summary` saja, biarkan `chat_summary_json` tetap nilai sebelumnya).
  - `short_summary` di-trim & dipotong maksimal 800 karakter.
  - Enum field di-whitelist; nilai tak dikenal → null.
- `updateThreadSummary(supabase, threadId, structured)`:
  - update `chat_summary = short_summary`, `chat_summary_json = structured`, `chat_summary_updated_at = now()`, `chat_summary_version = chat_summary_version + 1`.
  - Konstanta: `SUMMARY_MAX_CHARS = 800`.
- Tetap dipanggil background (fire-and-forget via `getWaitUntil`) — tidak menambah latency reply ke tamu. Logging tambahan:
  - "summary skipped: cooldown"
  - "summary skipped: booking flow aktif"
  - "summary generated" + threadId + version
  - "summary failed invalid JSON" + sample
- Tambahkan helper exported `regenerateThreadSummary(threadId)` & `clearThreadSummary(threadId)` untuk dipanggil admin function.

## 3. Context resolver (`src/ai/router/context-resolver.ts`)

- Ubah `seedEntityFromSummary` jadi menerima `{ chatSummary, chatSummaryJson, rooms }`:
  - prioritas 1: `chatSummaryJson.room_type` → cari di rooms list (case-insensitive).
  - prioritas 2: regex existing dari `chat_summary` text.
- Update caller di `multi-agent-orchestrator.ts` (line ~536) mengoper kedua field.

## 4. Multi-agent orchestrator (`src/ai/multi-agent-orchestrator.ts`)

- Perluas `AgentCtx` (di `src/ai/types.ts` jika ada — kalau tidak, di file orchestrator) dengan `chatSummaryJson?: StructuredSummary`.
- Di builder system prompt (line 178): inject blok terstruktur jika tersedia, contoh:
  ```
  RINGKASAN PERCAKAPAN SEBELUMNYA:
  <short_summary>

  KONTEKS TERSTRUKTUR (gunakan sebagai konteks, JANGAN konfirmasi ulang kecuali tamu menyebut data baru):
  - Tipe kamar: <room_type|->
  - Status booking: <booking_status|->
  - Status pembayaran: <payment_status|->
  - Check-in / out: <check_in> → <check_out>
  - Pertanyaan belum terjawab: <unresolved_question|->
  ```
- Tambah instruksi: "Jika tamu menyebut tanggal/jenis kamar baru dalam pesan terakhir, ABAIKAN nilai lama di konteks terstruktur."
- Propagasi `chatSummaryJson` dari `wa-autoreply.service.ts` saat membangun `agentCtx`.

## 5. wa-autoreply context loading

- Saat memetakan hasil RPC ke `agentCtx`, sertakan `chatSummaryJson` (default `{}` → undefined kalau kosong).

## 6. Admin UI WhatsApp thread detail

- `src/admin/functions/whatsapp.functions.ts`: tambah 2 server fn (with `requireSupabaseAuth` + role check super_admin via has_role):
  - `regenerateThreadSummaryFn({ threadId })` — load 30 msg terakhir, panggil generateSessionSummary, save.
  - `clearThreadSummaryFn({ threadId })` — set chat_summary=null, chat_summary_json='{}', updated_at=now().
- `src/routes/admin/whatsapp.tsx`: di panel detail thread tambahkan card "Context Summary":
  - tampilkan `chat_summary` (short), `chat_summary_updated_at` (format DD/MM/YYYY HH:mm).
  - badge grid: room_type, last_topic, booking_status, payment_status, unresolved_question, needs_human.
  - tombol "Regenerate Summary" (loading state) dan "Clear Summary" (confirm dialog).
  - invalidate React Query setelah mutasi.

## 7. Types

- `src/integrations/supabase/types.ts` akan ter-regenerate otomatis setelah migration approved.
- Tambah type `StructuredSummary` di `src/services/wa-autoreply.service.ts` dan re-export untuk dipakai orchestrator + admin UI.

## 8. Non-goals / jaminan

- Tidak mengubah: queue worker, smart delay, booking state machine, routing agent, intent classifier.
- Summarizer tetap fire-and-forget via `waitUntil` (sudah ada pattern).
- Tidak menambah dependency baru.

## Acceptance criteria

- Pesan baru tamu memicu reply tanpa tambahan latency (summary jalan di background).
- Setelah summarizer sukses, `chat_summary_json` terisi sesuai schema; field tidak disebut tamu = null.
- Follow-up "kalau deluxe?" diproses dengan `room_type` di prompt sehingga agent tidak menanyakan ulang tipe kamar.
- Admin bisa melihat, regenerate, dan clear summary dari halaman WhatsApp.
- JSON invalid → fallback aman, log tercatat, autoreply tetap berjalan.
