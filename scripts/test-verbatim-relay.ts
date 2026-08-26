/**
 * Regresi relay verbatim — lever #4 audit anggaran token 26 Agu 2026.
 *
 * Sebagian hasil tool SUDAH berupa teks final untuk tamu, dan prompt agent
 * memang menyuruh mengirimnya apa adanya. Untuk kasus itu orkestrator
 * menyelesaikan giliran tanpa panggilan LLM kedua.
 *
 * Yang dikunci di sini:
 *   1. Tool yang menjanjikan teks final BENAR-BENAR menandainya
 *      (`relay_verbatim: true`) — kalau flag-nya hilang, penghematan diam-diam
 *      mati tanpa ada yang gagal.
 *   2. Penjagaannya utuh: banyak tool call dan `media_request` TIDAK boleh
 *      di-short-circuit.
 *   3. Teks yang diteruskan persis sama dengan yang dibuat tool.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveVerbatimRelay } from "../src/ai/multi-agent-orchestrator";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// ─── 1. Kontrak: tool yang bilang "VERBATIM" wajib menandai relay_verbatim ──
// Dicek di level sumber karena tool-nya butuh Supabase untuk dijalankan.
// Tiap entri: file, penanda cabang, dan berapa kali `relay_verbatim: true`
// minimal harus muncul di file itu.

const VERBATIM_TOOLS: Array<[string, string[], number]> = [
  [
    "src/tools/availability.tool.ts",
    [
      "need_dates: true",
      "availability_unknown: true",
      'availabilityStatus === "sold_out"',
      // sold_out & insufficient_capacity memakai bentuk kondisional: flag hanya
      // menyala kalau tool memang menyusun reply_to_guest.
      "relay_verbatim: replyToGuest ? true : undefined",
    ],
    2,
  ],
  ["src/tools/start-booking.tool.ts", ["relay_verbatim: true"], 2],
  ["src/tools/generate-booking-form.tool.ts", ["suggested_reply: suggestedReply"], 1],
  ["src/tools/offer-alternative-rooms.tool.ts", ["relay_verbatim: true"], 1],
];

for (const [file, markers, minFlags] of VERBATIM_TOOLS) {
  const src = read(file);
  for (const m of markers) {
    assert.ok(src.includes(m), `${file}: cabang "${m}" hilang — kontrak relay berubah?`);
  }
  const flags = src.split("relay_verbatim: true").length - 1;
  assert.ok(
    flags >= minFlags,
    `${file}: hanya ${flags} penanda relay_verbatim, minimal ${minFlags}. ` +
      "Tanpa penanda ini orkestrator terpaksa memanggil LLM lagi hanya untuk membungkus ulang teks yang sudah jadi.",
  );
}

// ─── 2. Kasus yang HARUS di-short-circuit ──────────────────────────────────

const soldOut = JSON.stringify({
  availability_status: "sold_out",
  relay_verbatim: true,
  reply_to_guest: "Maaf Kak, untuk tanggal 1 – 2 September 2026 seluruh kamar kami sudah penuh.",
});
assert.equal(
  resolveVerbatimRelay({ toolCallCount: 1, output: soldOut, intent: "availability_check" }),
  "Maaf Kak, untuk tanggal 1 – 2 September 2026 seluruh kamar kami sudah penuh.",
);

const needDates = JSON.stringify({
  ok: true,
  need_dates: true,
  relay_verbatim: true,
  reply_to_guest: "Boleh tahu untuk tanggal berapa Kakak rencana menginap, dan sampai tanggal berapa ya? 📅",
});
assert.ok(resolveVerbatimRelay({ toolCallCount: 1, output: needDates, intent: "booking_inquiry" }));

// `message` (start_booking_details, offer_alternative_rooms)
assert.equal(
  resolveVerbatimRelay({
    toolCallCount: 1,
    output: JSON.stringify({ ok: true, relay_verbatim: true, message: "Ringkasan booking Kakak..." }),
    intent: "booking_inquiry",
  }),
  "Ringkasan booking Kakak...",
);

// `suggested_reply` (generate_booking_form) — URL sekali pakai, jangan ditulis ulang
assert.equal(
  resolveVerbatimRelay({
    toolCallCount: 1,
    output: JSON.stringify({ ok: true, relay_verbatim: true, suggested_reply: "Isi form: https://x/y" }),
    intent: "booking_inquiry",
  }),
  "Isi form: https://x/y",
);

// Tanpa intent (simulator / entry point lama) tetap boleh short-circuit —
// penjagaannya soal jumlah tool call dan media, bukan soal ada tidaknya intent.
assert.ok(resolveVerbatimRelay({ toolCallCount: 1, output: soldOut }));

// ─── 3. Penjagaan: kasus yang TIDAK boleh di-short-circuit ────────────────

assert.equal(
  resolveVerbatimRelay({ toolCallCount: 2, output: soldOut, intent: "availability_check" }),
  null,
  "beberapa tool dalam satu giliran → balasan harus menggabungkan hasilnya, biarkan LLM menyusun",
);
assert.equal(
  resolveVerbatimRelay({ toolCallCount: 1, output: soldOut, intent: "media_request" }),
  null,
  "permintaan media butuh kalimat pengantar + lampiran (invarian #1) — jangan diteruskan mentah",
);

// Hasil availability normal (`available`) TIDAK ditandai verbatim: presentasinya
// memang tugas LLM ("PRESENTASI HASIL: gaya resepsionis yang natural").
const available = JSON.stringify({
  availability_status: "available",
  total_kamar_tersedia: 3,
  kamar: [{ nama: "Deluxe", kamar_tersedia: 2, harga_per_malam: 300000 }],
});
assert.equal(resolveVerbatimRelay({ toolCallCount: 1, output: available, intent: "availability_check" }), null);

// Bentuk rusak / tidak relevan
for (const bad of [
  "bukan json",
  "",
  JSON.stringify({ relay_verbatim: false, reply_to_guest: "x" }),
  JSON.stringify({ relay_verbatim: true }),
  JSON.stringify({ relay_verbatim: true, reply_to_guest: "   " }),
  JSON.stringify({ relay_verbatim: "true", reply_to_guest: "x" }),
]) {
  assert.equal(
    resolveVerbatimRelay({ toolCallCount: 1, output: bad, intent: "general" }),
    null,
    `output tidak valid harus jatuh ke jalur normal: ${bad.slice(0, 40)}`,
  );
}

// ─── 4. Teks diteruskan apa adanya (hanya trim) ──────────────────────────

const withWhitespace = JSON.stringify({
  relay_verbatim: true,
  reply_to_guest: "\n  Maaf Kak, kamar penuh.\n  ",
});
assert.equal(
  resolveVerbatimRelay({ toolCallCount: 1, output: withWhitespace, intent: "availability_check" }),
  "Maaf Kak, kamar penuh.",
  "hanya trim — jangan pernah menulis ulang isi",
);

// Prioritas field bila lebih dari satu terisi.
assert.equal(
  resolveVerbatimRelay({
    toolCallCount: 1,
    output: JSON.stringify({ relay_verbatim: true, reply_to_guest: "A", message: "B" }),
    intent: "general",
  }),
  "A",
);

console.log("✓ verbatim relay regressions passed");
