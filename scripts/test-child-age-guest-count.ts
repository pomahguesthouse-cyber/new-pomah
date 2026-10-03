/**
 * Usia anak bukan jumlah anak — insiden 3 Okt 2026.
 *
 * Bot (CONFIRMING_BOOKING) bertanya usia, tamu menjawab persis
 * "Usia anak 14 dan 6 th". Parser lama menulis "3 dewasa, 14 anak"
 * (14 jadi jumlah, 6 hilang) lalu menolak karena kapasitas.
 * Sebelumnya "3 dewasa, 1 anak" sudah benar dan tidak boleh berubah
 * hanya karena pesan usia.
 *
 * `bun run test:child-age-guest-count`
 */
import assert from "node:assert/strict";
import { parseGuestCountFollowup } from "../src/services/wa-autoreply/message-parsers";
import { extractAllSlots } from "../src/ai/state-machine/flexible-slot-extractor";
import { parseSlotCorrection } from "../src/ai/state-machine/booking-machine";
import { mergeGuestCountReading, readGuestCount } from "../src/lib/guest-party";
import { resolveContext } from "../src/ai/router/context-resolver";
import { RULES } from "../src/ai/router/intent-classifier";

const TODAY = "2026-10-03";
const noRooms: Array<{ id: string; name: string }> = [];

function slotsOf(message: string) {
  return extractAllSlots(message, noRooms, undefined, TODAY);
}

// ── Insiden: usia tidak menjadi jumlah ───────────────────────────────────────
assert.equal(
  parseGuestCountFollowup("Usia anak 14 dan 6 th"),
  null,
  "jawaban usia saja bukan follow-up jumlah tamu (bukan 14 anak)",
);

const incidentRead = readGuestCount("Usia anak 14 dan 6 th");
assert.deepEqual(incidentRead?.childAges, [14, 6]);
assert.equal(incidentRead?.children, undefined);
assert.equal(incidentRead?.adults, undefined);

const incidentSlots = slotsOf("Usia anak 14 dan 6 th");
assert.deepEqual(incidentSlots.childAges, [14, 6]);
assert.equal(incidentSlots.children, undefined, "extractor tidak boleh mengisi children=14");
assert.equal(incidentSlots.adults, undefined);

const incidentPatch = parseSlotCorrection("Usia anak 14 dan 6 th");
assert.equal(incidentPatch.changed, true);
assert.deepEqual(incidentPatch.patch.childAges, [14, 6]);
assert.equal(incidentPatch.patch.children, undefined);
assert.equal(incidentPatch.patch.adults, undefined);

// Jumlah yang sudah diketahui (3 dewasa, 1 anak) tidak berubah.
const kept = mergeGuestCountReading(
  { adults: 3, children: 1 },
  { childAges: incidentRead?.childAges },
);
assert.equal(kept.adults, 3);
assert.equal(kept.children, 1, "usia tidak menimpa jumlah anak yang sudah benar");
assert.deepEqual(kept.childAges, [14, 6]);
assert.equal(kept.adults + kept.children, 4, "kapasitas tetap 4 tamu, bukan 17");

// Jumlah anak belum diketahui → banyaknya usia.
const inferred = mergeGuestCountReading({}, { childAges: [14, 6] });
assert.equal(inferred.children, 2);
assert.deepEqual(inferred.childAges, [14, 6]);

// ── Varian usia ──────────────────────────────────────────────────────────────
const ageCases: Array<[string, number[]]> = [
  ["umur anak 5 tahun", [5]],
  ["anaknya 4 th dan 9 th", [4, 9]],
  ["anak umur 7", [7]],
  ["usia anak 14 dan 6 th", [14, 6]],
];
for (const [message, ages] of ageCases) {
  const reading = readGuestCount(message);
  assert.deepEqual(reading?.childAges, ages, message);
  assert.equal(reading?.children, undefined, `bukan jumlah: ${message}`);
  const extracted = slotsOf(message);
  assert.deepEqual(extracted.childAges, ages, message);
  assert.notEqual(extracted.children, ages[0], `usia tidak dipakai sebagai jumlah: ${message}`);
  const merged = mergeGuestCountReading({}, { childAges: reading?.childAges });
  assert.equal(merged.children, ages.length, `jumlah = banyaknya usia: ${message}`);
}

// Hitung eksplisit + usia di pesan yang sama: jumlah menang, usia tetap disimpan.
const mixed = readGuestCount("3 dewasa, 1 anak usia 14 dan 6 th");
assert.equal(mixed?.adults, 3);
assert.equal(mixed?.children, 1);
assert.deepEqual(mixed?.childAges, [14, 6]);
assert.deepEqual(parseGuestCountFollowup("3 dewasa, 1 anak usia 14 dan 6 th"), {
  adults: 3,
  children: 1,
  total: 4,
});
const mixedSlots = slotsOf("3 dewasa, 1 anak usia 14 dan 6 th");
assert.equal(mixedSlots.adults, 3);
assert.equal(mixedSlots.children, 1);
assert.deepEqual(mixedSlots.childAges, [14, 6]);

// Dewasa disebut, usia disebut, jumlah anak tidak: jumlah = banyaknya usia.
assert.deepEqual(parseGuestCountFollowup("3 dewasa usia anak 5 dan 7 tahun"), {
  adults: 3,
  children: 2,
  total: 5,
});
const agesWithAdults = slotsOf("3 dewasa usia anak 5 dan 7 tahun");
assert.equal(agesWithAdults.adults, 3);
assert.equal(agesWithAdults.children, 2);
assert.deepEqual(agesWithAdults.childAges, [5, 7]);

// ── Pola jumlah yang sudah ada ───────────────────────────────────────────────
assert.deepEqual(parseGuestCountFollowup("5 dewasa 2 anak"), { adults: 5, children: 2, total: 7 });
assert.deepEqual(parseGuestCountFollowup("dewasa 5 anak 2"), { adults: 5, children: 2, total: 7 });
assert.deepEqual(parseGuestCountFollowup("2 dewasa 1 anak"), { adults: 2, children: 1, total: 3 });
assert.deepEqual(parseGuestCountFollowup("4 (1 anak kecil)"), { adults: 3, children: 1, total: 4 });
assert.deepEqual(parseGuestCountFollowup("dewasa 5 (1 anak)"), {
  adults: 5,
  children: 1,
  total: 6,
});
assert.deepEqual(parseGuestCountFollowup("3 dewasa, 1 anak"), { adults: 3, children: 1, total: 4 });
assert.deepEqual(parseGuestCountFollowup("Dewasa 5 anak 2"), { adults: 5, children: 2, total: 7 });
assert.deepEqual(parseGuestCountFollowup("2 dewasa dan 2 bocil"), {
  adults: 2,
  children: 2,
  total: 4,
});
assert.deepEqual(parseGuestCountFollowup("untuk 3 orang"), { adults: 3, children: 0, total: 3 });
assert.deepEqual(parseGuestCountFollowup("dewasa: 4, anak: 1"), {
  adults: 4,
  children: 1,
  total: 5,
});
assert.deepEqual(parseGuestCountFollowup("3 orang dewasa 1 anak"), {
  adults: 3,
  children: 1,
  total: 4,
});

for (const message of ["5 dewasa 2 anak", "dewasa 5 anak 2", "2 dewasa 1 anak"]) {
  const extracted = slotsOf(message);
  const follow = parseGuestCountFollowup(message)!;
  assert.equal(extracted.adults, follow.adults, message);
  assert.equal(extracted.children, follow.children, message);
  assert.equal(extracted.childAges, undefined, message);
}

const paren = slotsOf("4 (1 anak kecil)");
assert.equal(paren.children, 1);
assert.equal(paren.adults, 3, "4 (1 anak kecil) = total 4, dewasa 3");
assert.equal(paren.childAges, undefined);

const parenPatch = parseSlotCorrection("4 (1 anak kecil)");
assert.equal(parenPatch.patch.children, 1);
assert.equal(parenPatch.patch.adults, 3);
assert.equal(parenPatch.patch.childAges, undefined);

const labeledParen = slotsOf("dewasa 5 (1 anak)");
assert.equal(labeledParen.adults, 5, "angka yang sudah berlabel dewasa tidak diubah");
assert.equal(labeledParen.children, 1);

// Slot percakapan: usia tidak menimpa children yang sudah ada.
const resolved = resolveContext("Usia anak 14 dan 6 th", { slots: { adults: 3, children: 1 } }, []);
assert.equal(resolved.slots.adults, 3);
assert.equal(resolved.slots.children, 1);
assert.deepEqual(resolved.slots.childAges, [14, 6]);

const resolvedUnknown = resolveContext("Usia anak 14 dan 6 th", { slots: {} }, []);
assert.equal(resolvedUnknown.slots.children, 2);
assert.deepEqual(resolvedUnknown.slots.childAges, [14, 6]);

// Jawaban usia tidak diklasifikasi sebagai input jumlah tamu.
const guestRule = RULES.find((r) => r.category === "guest_count_input");
assert.ok(guestRule);
assert.equal(
  guestRule!.patterns.some((p) => p.test("Usia anak 14 dan 6 th")),
  false,
);
assert.equal(
  guestRule!.patterns.some((p) => p.test("5 dewasa 2 anak")),
  true,
);
assert.equal(
  guestRule!.patterns.some((p) => p.test("dewasa 5 anak 2")),
  true,
);
assert.equal(
  guestRule!.patterns.some((p) => p.test("2 dewasa 1 anak")),
  true,
);

console.log("✓ child-age guest-count regressions passed");
