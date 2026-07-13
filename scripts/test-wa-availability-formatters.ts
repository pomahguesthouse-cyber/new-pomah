import assert from "node:assert/strict";
import {
  buildAvailabilityNeedDatesReply,
  formatAvailabilityForGuestCount,
  formatAvailabilityReply,
  lastBotAskedGuestCount,
} from "../src/services/wa-autoreply/availability-formatters";

const availableRaw = JSON.stringify({
  periode: "11-12 Juli 2026",
  kamar: [
    {
      nama: "Single",
      kamar_tersedia: 1,
      harga_per_malam: 150000,
      tidak_tersedia: false,
      cocok_untuk_jumlah_tamu: false,
      kapasitas_maksimal_dengan_extra_bed: 1,
    },
    {
      nama: "Family",
      kamar_tersedia: 2,
      harga_per_malam: 350000,
      tidak_tersedia: false,
      cocok_untuk_jumlah_tamu: true,
      kapasitas_maksimal_dengan_extra_bed: 4,
      extra_bed_dibutuhkan: 1,
      tarif_extra_bed_per_malam: 75000,
    },
  ],
});

const fullRaw = JSON.stringify({
  periode: "11-12 Juli 2026",
  kamar: [
    {
      nama: "Deluxe",
      kamar_tersedia: 0,
      harga_per_malam: 250000,
      tidak_tersedia: true,
    },
  ],
});

const needDates = buildAvailabilityNeedDatesReply("Halo, ada kamar?");
assert.equal(needDates.intent, "deterministic_availability_need_dates");
assert.match(needDates.reply, /^Halo Kak,/);
assert.match(needDates.reply, /tanggal berapa sampai tanggal berapa/);

const sourceAware = buildAvailabilityNeedDatesReply("ada kamar?", ["Saya lihat dari TikTok"]);
assert.match(sourceAware.reply, /^Terima kasih infonya Kak\./);

const available = formatAvailabilityReply(availableRaw, true);
assert.ok(available);
assert.equal(available.intent, "deterministic_availability");
assert.match(available.reply, /^Halo Kak, untuk tanggal 11-12 Juli 2026/);
assert.match(available.reply, /Single: 1 kamar tersedia, Rp150\.000\/malam/);
assert.match(available.reply, /Family: 2 kamar tersedia, Rp350\.000\/malam/);
assert.match(available.reply, /Kakak rencana untuk berapa orang\?/);

const full = formatAvailabilityReply(fullRaw);
assert.ok(full);
assert.equal(full.intent, "deterministic_availability_full");
assert.match(full.reply, /kamar kami sudah penuh/);

assert.equal(formatAvailabilityReply("invalid json"), null);
assert.equal(formatAvailabilityReply(JSON.stringify({ kamar: null })), null);

assert.equal(
  lastBotAskedGuestCount([
    { direction: "in", body: "Ada kamar besok?" },
    { direction: "out", body: "Masih tersedia. Kakak rencana untuk berapa orang?" },
  ]),
  true,
);
assert.equal(
  lastBotAskedGuestCount([
    { direction: "out", body: "Masih tersedia." },
    { direction: "in", body: "Untuk dua orang" },
  ]),
  false,
);

const suitable = formatAvailabilityForGuestCount(availableRaw, {
  adults: 2,
  children: 1,
  total: 3,
});
assert.ok(suitable);
assert.equal(suitable.intent, "deterministic_availability_guest_count");
assert.match(suitable.reply, /2 dewasa dan 1 anak/);
assert.match(suitable.reply, /Family: 2 kamar tersedia/);
assert.match(suitable.reply, /butuh 1 extra bed @ Rp75\.000\/malam/);
assert.doesNotMatch(suitable.reply, /Single: 1 kamar tersedia/);

const overCapacityRaw = JSON.stringify({
  periode: "11-12 Juli 2026",
  kamar: [
    {
      nama: "Single",
      kamar_tersedia: 1,
      tidak_tersedia: false,
      cocok_untuk_jumlah_tamu: false,
      kapasitas_maksimal_dengan_extra_bed: 1,
    },
  ],
});
const overCapacity = formatAvailabilityForGuestCount(overCapacityRaw, {
  adults: 3,
  children: 0,
  total: 3,
});
assert.ok(overCapacity);
assert.equal(overCapacity.intent, "deterministic_availability_over_capacity");
assert.match(overCapacity.reply, /stok kamar yang tersedia belum cukup untuk 3 tamu/);
assert.doesNotMatch(overCapacity.reply, /kalau ada/i);

const multiRoomRaw = JSON.stringify({
  periode: "7 Agustus 2026 – 8 Agustus 2026",
  availability_status: "available",
  total_kapasitas_tersedia: 6,
  inventori_tersedia: [
    {
      nama: "Deluxe",
      jumlah_kamar: 2,
      kapasitas_per_kamar: 3,
      harga_per_malam: 400000,
    },
  ],
  kamar: [
    {
      nama: "Deluxe",
      kamar_tersedia: 2,
      harga_per_malam: 400000,
      tidak_tersedia: false,
      cocok_untuk_jumlah_tamu: false,
      kapasitas_maksimal_dengan_extra_bed: 3,
    },
  ],
});
const multiRoom = formatAvailabilityForGuestCount(multiRoomRaw, {
  adults: 5,
  children: 1,
  total: 6,
});
assert.ok(multiRoom);
assert.equal(multiRoom.intent, "deterministic_availability_multi_room_combination");
assert.match(multiRoom.reply, /2 kamar Deluxe/);
assert.match(multiRoom.reply, /total Rp800\.000\/malam/);

const terminalCapacityRaw = JSON.stringify({
  periode: "7 Agustus 2026 – 8 Agustus 2026",
  availability_status: "insufficient_capacity",
  relay_verbatim: true,
  reply_to_guest:
    "Maaf Kak, untuk tanggal 7 Agustus 2026 – 8 Agustus 2026 kamar yang tersedia belum cukup untuk menampung 6 orang.",
  kamar: [
    {
      nama: "Deluxe",
      kamar_tersedia: 1,
      tidak_tersedia: false,
      cocok_untuk_jumlah_tamu: false,
      kapasitas_maksimal_dengan_extra_bed: 3,
    },
  ],
});
const terminalCapacity = formatAvailabilityForGuestCount(terminalCapacityRaw, {
  adults: 5,
  children: 1,
  total: 6,
});
assert.ok(terminalCapacity);
assert.equal(terminalCapacity.intent, "deterministic_availability_over_capacity");
assert.equal(
  terminalCapacity.reply,
  "Maaf Kak, untuk tanggal 7 Agustus 2026 – 8 Agustus 2026 kamar yang tersedia belum cukup untuk menampung 6 orang.",
);

const fullForGuests = formatAvailabilityForGuestCount(fullRaw, {
  adults: 2,
  children: 0,
  total: 2,
});
assert.ok(fullForGuests);
assert.equal(fullForGuests.intent, "deterministic_availability_full");

console.log("✓ WhatsApp availability formatter regressions passed");
