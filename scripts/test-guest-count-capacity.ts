/**
 * Regresi: jumlah tamu default mengikuti kapasitas kamar (7 Agustus 2026).
 *
 * Permintaan operasional: invoice Deluxe (kapasitas 2) tertulis 2 tamu, Family
 * Room (kapasitas 4) tertulis 4 tamu, ketika jumlah tamu tidak disebutkan.
 * Sebelumnya semua booking tanpa jumlah tamu jatuh ke 1.
 *
 * ATURAN yang dikunci di sini: kapasitas hanya DEFAULT. Angka yang disebut
 * tamu/staf selalu menang — termasuk bila lebih kecil dari kapasitas.
 */

import assert from "node:assert/strict";

import {
  capacityForSelection,
  guestCountWasStated,
  resolveAdultsForBooking,
} from "../src/lib/guest-count";

const rooms = [
  { id: "single", capacity: 1 },
  { id: "deluxe", capacity: 2 },
  { id: "grand", capacity: 3 },
  { id: "family", capacity: 4 },
  { id: "unknown", capacity: null },
];

const sel = (id: string, quantity = 1) => [{ roomTypeId: id, quantity }];

// ── Deteksi "disebut" vs "tidak disebut" ────────────────────────────────────
assert.equal(guestCountWasStated(2), true);
assert.equal(guestCountWasStated(1), true, "1 yang disebut tetap dihormati");
assert.equal(guestCountWasStated("3"), true);
assert.equal(guestCountWasStated(undefined), false);
assert.equal(guestCountWasStated(null), false);
assert.equal(guestCountWasStated(""), false);
assert.equal(guestCountWasStated(0), false);
assert.equal(guestCountWasStated("dua"), false);

// ── Kapasitas per pilihan kamar ─────────────────────────────────────────────
assert.equal(capacityForSelection(sel("deluxe"), rooms), 2);
assert.equal(capacityForSelection(sel("family"), rooms), 4);
assert.equal(capacityForSelection(sel("single"), rooms), 1);
assert.equal(capacityForSelection(sel("deluxe", 2), rooms), 4, "2 kamar Deluxe = 4 tamu");
assert.equal(
  capacityForSelection([{ roomTypeId: "deluxe" }, { roomTypeId: "family" }], rooms),
  6,
  "Deluxe + Family = 2 + 4",
);
assert.equal(capacityForSelection(sel("unknown"), rooms), null, "kapasitas tidak diketahui");
assert.equal(capacityForSelection([], rooms), null);
assert.equal(capacityForSelection(sel("tidak-ada"), rooms), null);

// ── Kasus utama dari permintaan ─────────────────────────────────────────────
assert.equal(resolveAdultsForBooking(undefined, sel("deluxe"), rooms), 2, "Deluxe → 2 tamu");
assert.equal(resolveAdultsForBooking(undefined, sel("family"), rooms), 4, "Family Room → 4 tamu");
assert.equal(resolveAdultsForBooking(undefined, sel("single"), rooms), 1);
assert.equal(resolveAdultsForBooking(undefined, sel("grand"), rooms), 3);

// Multi-kamar: dijumlahkan.
assert.equal(resolveAdultsForBooking(undefined, sel("deluxe", 3), rooms), 6);
assert.equal(
  resolveAdultsForBooking(undefined, [{ roomTypeId: "family" }, { roomTypeId: "deluxe" }], rooms),
  6,
);

// ── Angka yang disebut selalu menang ────────────────────────────────────────
assert.equal(resolveAdultsForBooking(2, sel("family"), rooms), 2, "tamu bilang 2 di Family → 2");
assert.equal(resolveAdultsForBooking(1, sel("family"), rooms), 1);
assert.equal(resolveAdultsForBooking(5, sel("deluxe"), rooms), 5, "lebih dari kapasitas pun dihormati");
assert.equal(resolveAdultsForBooking("3", sel("deluxe"), rooms), 3);

// ── Anak ikut memakai kapasitas saat memakai default ────────────────────────
assert.equal(
  resolveAdultsForBooking(undefined, sel("family"), rooms, 2),
  2,
  "Family 4 dengan 2 anak → 2 dewasa (total tetap 4)",
);
assert.equal(
  resolveAdultsForBooking(undefined, sel("deluxe"), rooms, 5),
  1,
  "anak lebih banyak dari kapasitas → dewasa minimal 1",
);
// Kalau dewasa disebut, anak tidak mengurangi apa pun.
assert.equal(resolveAdultsForBooking(3, sel("family"), rooms, 2), 3);

// ── Kapasitas tidak diketahui → perilaku lama (1) ───────────────────────────
assert.equal(resolveAdultsForBooking(undefined, sel("unknown"), rooms), 1);
assert.equal(resolveAdultsForBooking(undefined, [], rooms), 1);

// ── Batas atas wajar ────────────────────────────────────────────────────────
assert.equal(resolveAdultsForBooking(undefined, sel("family", 10), rooms), 20);
assert.equal(resolveAdultsForBooking(999, sel("deluxe"), rooms), 20);

console.log("✓ Guest-count-from-capacity regressions passed");
