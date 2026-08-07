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

// Insiden 7 Agu 2026 (WA +62 877-0504-9842): tamu tanya "ada kamar kosong buat
// malam ini?" saat kamar memang PENUH, tetapi bot menjawab "kamar yang tersedia
// belum ada di sistem, saya bantu teruskan ke admin" — istilah internal bocor
// ke tamu dan peluang menawarkan tanggal alternatif hilang.
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
assert.equal(tonightFull.intent, "deterministic_tonight_availability_full");
assert.match(tonightFull.reply, /sudah penuh/i);
assert.match(tonightFull.reply, /tanggal lain/i, "harus menawarkan tanggal alternatif");
assert.doesNotMatch(tonightFull.reply, /belum ada di sistem|sistem|admin/i,
  "jangan bocorkan istilah internal ke tamu");

// Stok 0 tanpa flag tidak_tersedia → tetap penuh.
const tonightZeroStock = formatTonightAvailabilityReply(
  JSON.stringify({ kamar: [{ nama: "Deluxe", harga_per_malam: 250000, kamar_tersedia: 0 }] }),
  "2026-07-11",
  "2026-07-12",
);
assert.equal(tonightZeroStock!.intent, "deterministic_tonight_availability_full");
assert.match(tonightZeroStock!.reply, /sudah penuh/i);

// Status TIDAK diketahui (RPC gagal / semua tipe tanpa angka) → jangan klaim penuh.
const tonightUnknown = formatTonightAvailabilityReply(
  JSON.stringify({ kamar: [{ nama: "Deluxe", harga_per_malam: 250000, kamar_tersedia: null }] }),
  "2026-07-11",
  "2026-07-12",
);
assert.equal(tonightUnknown!.intent, "deterministic_tonight_availability_unknown");
assert.doesNotMatch(tonightUnknown!.reply, /penuh/i);

const tonightRpcError = formatTonightAvailabilityReply(
  JSON.stringify({ availability_unknown: true, kamar: [] }),
  "2026-07-11",
  "2026-07-12",
);
assert.equal(tonightRpcError!.intent, "deterministic_tonight_availability_unknown");
assert.doesNotMatch(tonightRpcError!.reply, /penuh/i);

assert.equal(formatTonightAvailabilityReply("invalid json", "2026-07-11", "2026-07-12"), null);

console.log("✓ WhatsApp availability context regressions passed");
