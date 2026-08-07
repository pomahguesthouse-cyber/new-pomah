/**
 * Regresi B6 (audit 7 Agustus 2026): SATU parser tanggal untuk semua jalur.
 *
 * Dulu ada empat implementasi terpisah — message-parsers (WhatsApp),
 * availability.tool (LLM tool), flexible-slot-extractor (state machine), dan
 * hasExplicitDateSignal (orchestrator) — dengan aturan tahun, toleransi typo,
 * dan validasi tanggal yang berbeda-beda. Test ini mengunci perilakunya:
 * untuk input yang sama, semua jalur harus menghasilkan tanggal yang sama.
 */

import assert from "node:assert/strict";

import {
  makeIsoDate,
  mentionsExplicitDateSignal,
  resolveIdDate,
  resolveMonthName,
  resolveYear,
} from "../src/lib/id-date";
import { parseAvailabilityDateRange } from "../src/services/wa-autoreply/message-parsers";
import { extractAllSlots } from "../src/ai/state-machine/flexible-slot-extractor";

const today = "2026-08-07"; // Jumat, 7 Agustus 2026
const rooms = [
  { id: "r1", name: "Deluxe", base_rate: 300000 },
  { id: "r2", name: "Family Room", base_rate: 500000 },
];

// ── Primitif ─────────────────────────────────────────────────────────────────
assert.equal(resolveMonthName("Agustus"), 8);
assert.equal(resolveMonthName("agu"), 8);
assert.equal(resolveMonthName("ags"), 8);
assert.equal(resolveMonthName("sepember"), 9, "typo umum harus tertangani");
assert.equal(resolveMonthName("agusutus"), 8);
assert.equal(resolveMonthName("kamar"), null);
assert.equal(resolveMonthName("malam"), null);
assert.equal(resolveMonthName("orang"), null);

// Rollover tahun: bulan yang sudah lewat → tahun depan.
assert.equal(resolveYear(1, undefined, today), 2027, "Januari dari Agustus = tahun depan");
assert.equal(resolveYear(8, undefined, today), 2026, "bulan berjalan = tahun ini");
assert.equal(resolveYear(12, undefined, today), 2026);
assert.equal(resolveYear(1, "26", today), 2026, "tahun eksplisit menang");

// Tanggal tidak nyata ditolak, bukan diteruskan sebagai string.
assert.equal(makeIsoDate(31, 2, 2026), null, "31 Februari tidak ada");
assert.equal(makeIsoDate(29, 2, 2028), "2028-02-29", "2028 kabisat");
assert.equal(makeIsoDate(29, 2, 2026), null);
assert.equal(resolveIdDate(8, "agustus", "2026", today), "2026-08-08");
assert.equal(resolveIdDate(3, "januari", undefined, today), "2027-01-03", "B2: jangan tanggal lampau");
assert.equal(resolveIdDate(31, "februari", undefined, today), null);
assert.equal(resolveIdDate(5, "kamar", undefined, today), null);

// ── Konsistensi lintas jalur ────────────────────────────────────────────────
// coerceDate di availability.tool tidak diekspor, jadi kita uji lewat resolveIdDate
// yang sekarang menjadi implementasinya — plus jalur WhatsApp & state machine
// yang menerima kalimat utuh.
const cases: Array<{ text: string; day: number; month: string; expected: string }> = [
  { text: "ada kamar tanggal 8 Agustus 2026?", day: 8, month: "agustus", expected: "2026-08-08" },
  { text: "mau menginap 25 Desember", day: 25, month: "desember", expected: "2026-12-25" },
  { text: "cek 3 Januari dong", day: 3, month: "januari", expected: "2027-01-03" },
  { text: "tanggal 18 sepember masih ada?", day: 18, month: "sepember", expected: "2026-09-18" },
];

for (const c of cases) {
  // Jalur 1 — WhatsApp fast-path.
  const wa = parseAvailabilityDateRange(c.text, today);
  assert.ok(wa, `message-parsers gagal untuk: ${c.text}`);
  assert.equal(wa!.checkIn, c.expected, `message-parsers salah untuk: ${c.text}`);

  // Jalur 2 — availability tool (implementasi coerceDate).
  assert.equal(
    resolveIdDate(c.day, c.month, undefined, today) ??
      resolveIdDate(c.day, c.month, c.expected.slice(0, 4), today),
    c.expected,
    `availability.tool salah untuk: ${c.text}`,
  );

  // Jalur 3 — state machine slot extractor.
  const slots = extractAllSlots(c.text, rooms, "6281234567890", today);
  assert.equal(slots.check_in, c.expected, `flexible-slot-extractor salah untuk: ${c.text}`);

  // Jalur 4 — deteksi sinyal tanggal di orchestrator.
  assert.equal(mentionsExplicitDateSignal(c.text), true, `sinyal tanggal terlewat: ${c.text}`);
}

// Pola kuantitas tidak boleh dibaca sebagai tanggal di jalur mana pun.
for (const noise of ["mau 3 kamar", "untuk 2 orang", "nginap 2 malam", "kami 4 dewasa"]) {
  assert.equal(parseAvailabilityDateRange(noise, today), null, `message-parsers: ${noise}`);
  assert.equal(mentionsExplicitDateSignal(noise), false, `sinyal palsu: ${noise}`);
  const slots = extractAllSlots(noise, rooms, "6281234567890", today);
  assert.equal(slots.check_in, undefined, `slot extractor menangkap tanggal palsu: ${noise}`);
}

// Kalimat yang menyebut kuantitas DAN tanggal: tanggalnya tetap terbaca
// (insiden 7 Agu 2026 — kandidat "1 kamar" dulu menutup "8 Agustus 2026").
{
  const text = "Halo kak, masih ada 1 kamar untuk tanggal 8 Agustus 2026";
  assert.equal(parseAvailabilityDateRange(text, today)!.checkIn, "2026-08-08");
  assert.equal(extractAllSlots(text, rooms, "6281234567890", today).check_in, "2026-08-08");
  assert.equal(mentionsExplicitDateSignal(text), true);
}

console.log("✓ Date parsing consistency regressions (B6) passed");
