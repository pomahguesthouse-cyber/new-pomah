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
  formatStayEcho,
  formatTodayLine,
  makeIsoDate,
  mentionsExplicitDateSignal,
  resolveIdDate,
  resolveMonthName,
  resolveRelativeDayRange,
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

// ── Nama hari relatif (Asia/Jakarta) ─────────────────────────────────────────
const THU_AM = "2026-10-08T10:00:00+07:00";
const THU_LATE = "2026-10-08T21:30:00+07:00";
const WED_EVE = "2026-10-07T20:40:00+07:00";
const SAT_EARLY = "2026-09-05T00:34:00+07:00";

function expectStay(
  text: string,
  now: string,
  checkIn: string,
  checkOut: string,
) {
  const resolved = resolveRelativeDayRange(text, now);
  assert.ok(resolved && !resolved.needsConfirm, `resolver gagal/ambigu: ${text}`);
  assert.equal(resolved!.checkIn, checkIn, `check-in ${text}`);
  assert.equal(resolved!.checkOut, checkOut, `check-out ${text}`);
  const today = now.slice(0, 10);
  const wa = parseAvailabilityDateRange(text, today, now);
  assert.deepEqual(wa, { checkIn, checkOut }, `message-parsers ${text}`);
  const slots = extractAllSlots(text, rooms, "6281234567890", today);
  // Slot extractor memakai jam siang untuk tanggal historis; kasus sebelum
  // cutoff 21:00 harus sama dengan resolver.
  if (now.slice(11, 16) < "21:00") {
    assert.equal(slots.check_in, checkIn, `slot check-in ${text}`);
    assert.equal(slots.check_out, checkOut, `slot check-out ${text}`);
  }
}

expectStay("Sabtu malam Minggu ada kamar?", THU_AM, "2026-10-10", "2026-10-11");
expectStay("malam minggu", THU_AM, "2026-10-10", "2026-10-11");
expectStay("malming kosong?", THU_AM, "2026-10-10", "2026-10-11");
expectStay("jumat malam sabtu", THU_AM, "2026-10-09", "2026-10-10");
expectStay("hari jumat ceck in masih ada kamar", THU_AM, "2026-10-09", "2026-10-10");
expectStay("Check in Sabtu sore Minggu pagi checkout", THU_AM, "2026-10-10", "2026-10-11");
expectStay("senin", THU_AM, "2026-10-12", "2026-10-13");
expectStay("weekend ini", THU_AM, "2026-10-10", "2026-10-11");
expectStay("kamis", THU_AM, "2026-10-08", "2026-10-09");
expectStay("kamis", THU_LATE, "2026-10-15", "2026-10-16");
expectStay("jumat besok tgl 9 sd 10", WED_EVE, "2026-10-09", "2026-10-10");
expectStay("besok tgl 5 6", SAT_EARLY, "2026-09-05", "2026-09-06");
expectStay("tanggal 5 dan 6 september", SAT_EARLY, "2026-09-05", "2026-09-06");
expectStay("tgl 9 sd 10", THU_AM, "2026-10-09", "2026-10-10");
expectStay("5 6", "2026-10-01T12:00:00+07:00", "2026-10-05", "2026-10-06");
expectStay("5 6", THU_AM, "2026-11-05", "2026-11-06");

assert.equal(
  resolveRelativeDayRange("Sabtu malam Minggu ada kamar?", THU_AM)?.echo,
  "Sabtu–Minggu, 10–11 Oktober 2026",
);
assert.equal(formatStayEcho("2026-10-10", "2026-10-11"), "Sabtu–Minggu, 10–11 Oktober 2026");

const ambiguous = resolveRelativeDayRange("minggu depan", THU_AM);
assert.equal(ambiguous?.needsConfirm, true);
assert.equal(ambiguous?.reason, "minggu-depan");
assert.equal(parseAvailabilityDateRange("minggu depan", "2026-10-08", THU_AM), null);
assert.equal(extractAllSlots("minggu depan", rooms, "6281234567890", "2026-10-08").check_in, undefined);
assert.equal(resolveRelativeDayRange("Sabtu depan", THU_AM)?.needsConfirm, true);

const earlyBesok = resolveRelativeDayRange("ada kamar besok?", SAT_EARLY);
assert.equal(earlyBesok?.needsConfirm, true);
assert.equal(earlyBesok?.reason, "besok-early");
assert.equal(parseAvailabilityDateRange("ada kamar besok?", "2026-09-05", SAT_EARLY), null);

assert.equal(mentionsExplicitDateSignal("hari jumat ceck in"), true);
assert.equal(mentionsExplicitDateSignal("nginap 2 minggu"), false, "durasi 2 minggu bukan nama hari");

const calendar = formatTodayLine("2026-10-08");
assert.ok(calendar.includes("Hari ini Kamis, 8 Oktober 2026 (WIB)"));
assert.ok(calendar.includes("Jumat 9 Okt"));
assert.ok(calendar.includes("Sabtu 10 Okt"));

console.log("✓ Date parsing consistency regressions (B6) passed");
