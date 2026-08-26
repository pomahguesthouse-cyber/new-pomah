/**
 * Regresi jendela ringkasan sesi — lever #5 audit anggaran token 26 Agu 2026.
 *
 * Summarizer dulu selalu membaca ULANG seluruh sesi tiap kali jalan, padahal
 * yang benar-benar baru cuma 1–2 pesan. Sekarang ada dua mode plus jalur
 * "tidak usah jalan sama sekali".
 *
 * Yang dikunci di sini: kapan boleh inkremental, kapan WAJIB baca ulang penuh
 * (supaya salah tafsir lama bisa terkoreksi), dan bahwa prompt inkremental
 * tidak pernah kehilangan instruksi "pertahankan field lama".
 */
import assert from "node:assert/strict";
import {
  planSummaryWindow,
  buildSummaryPrompt,
  resolveSummaryConfig,
  SUMMARY_INCREMENTAL_MAX_WINDOW,
  SUMMARY_FULL_RESYNC_AFTER_MS,
  type SummaryMessage,
} from "../src/services/wa-autoreply/session-summary";
import type { ChatSummaryStructured } from "../src/ai/chat-summary.types";

const T0 = Date.parse("2026-08-26T10:00:00.000Z");
const at = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

// Panjang pesan dibuat realistis (satu balasan WhatsApp ±120 karakter);
// dengan pesan sepanjang label saja, mode inkremental JUSTRU lebih boros.
const msg = (i: number, offsetMin: number): SummaryMessage => ({
  direction: i % 2 === 0 ? "in" : "out",
  body:
    i % 2 === 0
      ? `Pesan tamu nomor ${i}: boleh tahu kamar Deluxe masih ada untuk tanggal itu dan berapa harganya per malam ya Kak?`
      : `Balasan bot nomor ${i}: Baik Kak, untuk tanggal tersebut Deluxe masih tersedia dengan tarif Rp300.000 per malam.`,
  sent_at: at(offsetMin),
});

const summary = (over: Partial<ChatSummaryStructured> = {}): ChatSummaryStructured => ({
  short_summary: "Tamu menanyakan Deluxe untuk akhir pekan.",
  guest_name: "Budi",
  last_topic: "availability",
  room_type: "Deluxe",
  check_in: "2026-09-01",
  check_out: "2026-09-02",
  guest_count: 2,
  booking_status: "none",
  payment_status: null,
  complaint_active: false,
  unresolved_question: null,
  needs_human: false,
  handoff_reason: null,
  ...over,
});

// Sesi panjang: 20 pesan lama (sebelum ringkasan) + 2 pesan baru sesudahnya.
const older = Array.from({ length: 20 }, (_, i) => msg(i, i));
const watermark = at(20);
const newer = [msg(20, 21), msg(21, 22)];
const allMessages = [...older, ...newer];
const now = T0 + 23 * 60_000;

// ─── 1. Jalur inkremental normal ────────────────────────────────────────────

const plan = planSummaryWindow({
  messages: allMessages,
  previous: summary(),
  summaryUpdatedAt: watermark,
  existingSummary: "ringkasan teks lama",
  now,
});
assert.ok(plan, "seharusnya ada rencana — ada 2 pesan baru");
assert.equal(plan.mode, "incremental");
assert.equal(plan.window.length, 2, "hanya pesan sesudah batas air yang dikirim");
assert.deepEqual(plan.window.map((m) => m.body), newer.map((m) => m.body));

// ─── 2. Tidak ada pesan baru → JANGAN panggil LLM sama sekali ──────────────

assert.equal(
  planSummaryWindow({ messages: older, previous: summary(), summaryUpdatedAt: watermark, now }),
  null,
  "tidak ada pesan sesudah batas air → satu panggilan LLM utuh harus dilewati",
);
assert.equal(planSummaryWindow({ messages: [], previous: summary(), summaryUpdatedAt: watermark, now }), null);

// ─── 3. Kapan WAJIB baca ulang penuh ───────────────────────────────────────

const fullCases: Array<[string, Parameters<typeof planSummaryWindow>[0]]> = [
  ["belum ada ringkasan", { messages: allMessages, previous: null, summaryUpdatedAt: watermark, now }],
  ["short_summary kosong", {
    messages: allMessages, previous: summary({ short_summary: "  " }), summaryUpdatedAt: watermark, now,
  }],
  ["tidak ada batas air", { messages: allMessages, previous: summary(), summaryUpdatedAt: null, now }],
  ["batas air tidak valid", {
    messages: allMessages, previous: summary(), summaryUpdatedAt: "bukan tanggal", now,
  }],
  ["ringkasan sudah lama (drift)", {
    messages: allMessages,
    previous: summary(),
    summaryUpdatedAt: watermark,
    now: Date.parse(watermark) + SUMMARY_FULL_RESYNC_AFTER_MS + 1,
  }],
  ["ada pesan tanpa sent_at", {
    messages: [...allMessages, { direction: "in", body: "tanpa stempel waktu" }],
    previous: summary(),
    summaryUpdatedAt: watermark,
    now,
  }],
];
for (const [label, params] of fullCases) {
  const p = planSummaryWindow(params);
  assert.ok(p, `${label}: harus tetap menghasilkan rencana`);
  assert.equal(p.mode, "full", `${label}: wajib baca ulang seluruh sesi`);
  assert.equal(p.window.length, params.messages.length, `${label}: jendela = seluruh pesan`);
}

// Terlalu banyak pesan menumpuk → ringkasan lama sudah tidak layak jadi dasar.
const flood = Array.from({ length: SUMMARY_INCREMENTAL_MAX_WINDOW + 1 }, (_, i) => msg(i, 21 + i));
const floodPlan = planSummaryWindow({
  messages: [...older, ...flood],
  previous: summary(),
  summaryUpdatedAt: watermark,
  now: Date.parse(watermark) + 60_000,
});
assert.equal(floodPlan?.mode, "full", `>${SUMMARY_INCREMENTAL_MAX_WINDOW} pesan baru → baca ulang penuh`);

// ─── 4. Prompt inkremental: lebih kecil, tapi tidak kehilangan pengaman ────

const prev = summary();
const incrementalPrompt = buildSummaryPrompt(plan, "ringkasan teks lama", prev);
const fullPrompt = buildSummaryPrompt({ mode: "full", window: allMessages }, "ringkasan teks lama", prev);

assert.ok(
  incrementalPrompt.length < fullPrompt.length,
  "prompt inkremental harus lebih kecil daripada baca-ulang-penuh",
);
assert.ok(
  !incrementalPrompt.includes("Pesan tamu nomor 0:"),
  "pesan lama tidak boleh ikut terkirim lagi di mode inkremental",
);
assert.ok(incrementalPrompt.includes("Pesan tamu nomor 20:"), "pesan baru wajib ada");

// ─── 4b. Sesi pendek: inkremental TIDAK menghemat → harus jatuh ke full ────
// Ringkasan JSON + instruksi "pertahankan field lama" itu sendiri punya biaya.
// Untuk transkrip yang lebih pendek dari biaya itu, baca-ulang-penuh lebih
// murah SEKALIGUS lebih akurat.

const shortSession = [msg(0, 0), msg(1, 1), msg(2, 21)];
const shortPlan = planSummaryWindow({
  messages: shortSession,
  previous: summary(),
  summaryUpdatedAt: at(20),
  existingSummary: "ringkasan teks lama",
  now: Date.parse(at(22)),
});
assert.equal(
  shortPlan?.mode,
  "full",
  "sesi pendek: inkremental tidak menghemat apa pun, jangan tukar akurasi dengan nol penghematan",
);
assert.ok(
  incrementalPrompt.includes(JSON.stringify(prev)),
  "ringkasan JSON lama wajib disertakan — itu yang membawa field lama maju",
);
for (const guard of [
  "PEMBARUAN, bukan penyusunan ulang",
  "WAJIB",
  "unresolved_question",
  "Jangan mengarang",
  "Jawab HANYA JSON valid",
]) {
  assert.ok(incrementalPrompt.includes(guard), `pengaman "${guard}" hilang dari prompt inkremental`);
}
// Aturan inti yang sama harus tetap berlaku di kedua mode.
for (const rule of ["Jangan mengarang", "ambil dari tanggal TERAKHIR yang disebut TAMU", "last_topic"]) {
  assert.ok(fullPrompt.includes(rule) && incrementalPrompt.includes(rule), `aturan "${rule}" harus ada di dua mode`);
}

// ─── 5. Model perangkum bisa diarahkan lewat env, default tidak berubah ────

const base = { apiKey: "k", baseUrl: "https://gw/v1", model: "google/gemini-3-flash-preview" };
delete process.env.SUMMARY_AI_MODEL;
assert.deepEqual(resolveSummaryConfig(base), base, "tanpa env, perilaku lama harus utuh");

process.env.SUMMARY_AI_MODEL = "google/gemini-2.5-flash-lite";
assert.equal(resolveSummaryConfig(base).model, "google/gemini-2.5-flash-lite");
assert.equal(resolveSummaryConfig(base).apiKey, base.apiKey, "kredensial tidak boleh ikut berubah");

process.env.SUMMARY_AI_MODEL = base.model;
assert.deepEqual(resolveSummaryConfig(base), base, "env sama dengan model utama → tidak ada override");
delete process.env.SUMMARY_AI_MODEL;

// ─── Ringkasan penghematan ─────────────────────────────────────────────────

const saved = fullPrompt.length - incrementalPrompt.length;
console.log(
  `✓ summary window regressions passed — prompt ${fullPrompt.length}→${incrementalPrompt.length} char ` +
    `(-${Math.round((saved / fullPrompt.length) * 100)}% untuk sesi 22 pesan)`,
);
