import assert from "node:assert/strict";
import {
  buildRecentAvailabilityNeedDatesReply,
  formatTonightAvailabilityReply,
} from "../src/services/wa-autoreply/availability-context";

const recentNeedDates = buildRecentAvailabilityNeedDatesReply([
  { direction: "in", body: "Halo, ada kamar?" },
  { direction: "in", body: "Saya lihat dari TikTok" },
]);
assert.ok(recentNeedDates);
assert.equal(recentNeedDates.intent, "deterministic_availability_need_dates");
assert.match(recentNeedDates.reply, /^Halo Kak,/);

const interrupted = buildRecentAvailabilityNeedDatesReply([
  { direction: "in", body: "Ada kamar?" },
  { direction: "out", body: "Selamat datang di Pomah Guesthouse" },
  { direction: "in", body: "Saya lihat dari TikTok" },
]);
assert.equal(interrupted, null);

const unrelatedFollowup = buildRecentAvailabilityNeedDatesReply([
  { direction: "in", body: "Ada kamar?" },
  { direction: "in", body: "Lokasinya di mana?" },
]);
assert.equal(unrelatedFollowup, null);

const tonightAvailable = formatTonightAvailabilityReply(
  JSON.stringify({
    kamar: [
      {
        nama: "Family",
        harga_per_malam: 350000,
        kamar_tersedia: 2,
        tidak_tersedia: false,
      },
      {
        nama: "Single",
        harga_per_malam: 150000,
        kamar_tersedia: 1,
        tidak_tersedia: false,
      },
    ],
  }),
  "2026-07-11",
  "2026-07-12",
);
assert.ok(tonightAvailable);
assert.equal(tonightAvailable.intent, "deterministic_tonight_price");
assert.match(tonightAvailable.reply, /Single: Rp150\.000\/malam/);
assert.ok(
  tonightAvailable.reply.indexOf("Single") < tonightAvailable.reply.indexOf("Family"),
  "rooms should be sorted from cheapest to most expensive",
);

const tonightFull = formatTonightAvailabilityReply(
  JSON.stringify({
    kamar: [
      {
        nama: "Deluxe",
        harga_per_malam: 250000,
        kamar_tersedia: 0,
        tidak_tersedia: true,
      },
    ],
  }),
  "2026-07-11",
  "2026-07-12",
);
assert.ok(tonightFull);
assert.equal(tonightFull.intent, "deterministic_tonight_availability");
assert.match(tonightFull.reply, /belum ada di sistem/);

assert.equal(formatTonightAvailabilityReply("invalid json", "2026-07-11", "2026-07-12"), null);

console.log("✓ WhatsApp availability context regressions passed");
