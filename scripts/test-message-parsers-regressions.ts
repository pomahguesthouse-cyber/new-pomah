import assert from "node:assert/strict";
import {
  hasRecentPriceContext,
  isAvailabilityNeedDatesQuestion,
  isAvailabilitySourceContext,
  isExplicitBookingOrder,
  isExplicitRoomCountRequirement,
  isPerRoomRentalClarification,
  isTonightReply,
  looksLikeBookingInquiry,
  messageOpensWithGreeting,
  parseAvailabilityDateRange,
  parseGuestCountFollowup,
  parseRequestedRoomCount,
  shouldUseDeterministicAvailability,
} from "../src/services/wa-autoreply/message-parsers";

const rooms = [{ name: "Deluxe" }, { name: "Family Room" }, { name: "Single" }];
const today = "2026-07-11";

assert.equal(isExplicitBookingOrder("Saya booking Deluxe tanggal 12 Juli", rooms), true);
assert.equal(isExplicitBookingOrder("Mau pesan kamar dong", rooms), false);
assert.equal(isExplicitBookingOrder("Tolong booking dengan extra bed", rooms), true);

assert.equal(looksLikeBookingInquiry("Masih ada kamar?"), true);
assert.equal(looksLikeBookingInquiry("Single ukuran kasurnya berapa?"), false);
assert.equal(looksLikeBookingInquiry("Harga per malam berapa?"), true);
assert.equal(isPerRoomRentalClarification("itungannya kamar ya kak berarti bukan rumah?"), true);
assert.equal(looksLikeBookingInquiry("itungannya kamar ya kak berarti bukan rumah?"), false);

// Permintaan jumlah kamar bukan jumlah tamu dan tidak boleh ditelan oleh
// contextual availability fast-path yang hanya mengulang stok.
assert.equal(parseRequestedRoomCount("mau 3 kamar kakk"), 3);
assert.equal(parseRequestedRoomCount("butuh kamar 2"), 2);
assert.equal(parseRequestedRoomCount("untuk 3 orang"), null);
assert.equal(isExplicitRoomCountRequirement("mau 3 kamar kakk"), true);
assert.equal(isExplicitRoomCountRequirement("3 kamar ya kak"), true);
assert.equal(isExplicitRoomCountRequirement("hanya 1 kamar ya kak?"), false);
assert.equal(looksLikeBookingInquiry("mau 3 kamar kakk"), false);
assert.equal(looksLikeBookingInquiry("hanya 1 kamar ya kak?"), true);
assert.equal(parseGuestCountFollowup("mau 3 kamar kakk"), null);

assert.equal(isTonightReply("Ada kamar malam ini?"), true);
assert.equal(isTonightReply("Ada kamar besok?"), false);
assert.equal(hasRecentPriceContext([{ direction: "out", body: "Harga Deluxe Rp300.000" }]), true);
assert.equal(
  hasRecentPriceContext([{ direction: "out", body: "Silakan kirim nama lengkap" }]),
  false,
);

assert.equal(messageOpensWithGreeting("Halo, ada kamar?"), true);
assert.equal(messageOpensWithGreeting("Ada kamar? Halo"), false);

assert.deepEqual(parseGuestCountFollowup("2 dewasa dan 2 bocil"), {
  adults: 2,
  children: 2,
  total: 4,
});
assert.deepEqual(parseGuestCountFollowup("untuk 3 orang"), { adults: 3, children: 0, total: 3 });
assert.equal(parseGuestCountFollowup("untuk keluarga"), null);

assert.deepEqual(parseAvailabilityDateRange("malam ini", today), {
  checkIn: "2026-07-11",
  checkOut: "2026-07-12",
});
assert.deepEqual(parseAvailabilityDateRange("besok", today), {
  checkIn: "2026-07-12",
  checkOut: "2026-07-13",
});
assert.deepEqual(parseAvailabilityDateRange("12-14 Juli 2026", today), {
  checkIn: "2026-07-12",
  checkOut: "2026-07-14",
});
assert.deepEqual(parseAvailabilityDateRange("3 Januari", today), {
  checkIn: "2027-01-03",
  checkOut: "2027-01-04",
});
assert.deepEqual(parseAvailabilityDateRange("31/12/26", today), {
  checkIn: "2026-12-31",
  checkOut: "2027-01-01",
});
assert.equal(parseAvailabilityDateRange("31 Februari 2027", today), null);

// Regresi: "bulan <nama_bulan> tanggal N-M" (nama bulan sebelum tanggal),
// termasuk typo "tangga" tanpa 'l' — dulu gagal dan bot minta tanggal ulang
// meski tamu sudah menyebutkannya (lihat isAvailabilityNeedDatesQuestion di bawah).
assert.deepEqual(
  parseAvailabilityDateRange("bulan september tangga 18-19 apakah masi kosong kak", today),
  { checkIn: "2026-09-18", checkOut: "2026-09-19" },
);
assert.deepEqual(parseAvailabilityDateRange("september tanggal 18-19", today), {
  checkIn: "2026-09-18",
  checkOut: "2026-09-19",
});
assert.deepEqual(parseAvailabilityDateRange("september 5", today), {
  checkIn: "2026-09-05",
  checkOut: "2026-09-06",
});
assert.equal(
  isAvailabilityNeedDatesQuestion(
    "untuk penginapan di pomah guest house bulan september tangga 18-19 apakah masi kosong kak",
    today,
  ),
  false,
);

assert.equal(shouldUseDeterministicAvailability("Ada kamar besok?"), true);
assert.equal(shouldUseDeterministicAvailability("Ada kamar?"), false);
assert.equal(isAvailabilityNeedDatesQuestion("Ada kamar kosong?", today), true);
assert.equal(isAvailabilityNeedDatesQuestion("Ada kamar kosong besok?", today), false);
assert.equal(isAvailabilitySourceContext("Saya lihat dari TikTok"), true);
assert.equal(isAvailabilitySourceContext("Saya ingin booking"), false);

console.log("✓ WhatsApp message parser regression cases passed");