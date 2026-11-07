/**
 * Regresi kasus Sofiah (8 Nov 2026): 7 tamu, check-in 11 Des, checkout belum disebut.
 * Data kamar: Family 4+2 extra, Deluxe 2+1 extra, Single 1+1 extra.
 */
import assert from "node:assert/strict";

import { buildRoomCombinationRecommendations } from "../src/tools/availability.tool";
import {
  appendCheckoutAssumedNote,
  formatAvailabilityForGuestCount,
} from "../src/services/wa-autoreply/availability-formatters";
import {
  guardCombinationCapacity,
  isInvalidCombinationLine,
} from "../src/services/wa-autoreply/combination-capacity-guard";
import { photoOfferAcceptanceText } from "../src/services/room-comparison";

const options = [
  { room_type_id: "deluxe", nama: "Deluxe Room", jumlah_kamar_tersedia: 3, kapasitas_tamu: 2, kapasitas_extra_bed: 1, tarif_extra_bed_per_malam: 100000, harga_per_malam: 225000 },
  { room_type_id: "single", nama: "Single Room", jumlah_kamar_tersedia: 1, kapasitas_tamu: 1, kapasitas_extra_bed: 1, tarif_extra_bed_per_malam: 100000, harga_per_malam: 150000 },
];

// ── A: kapasitas yang ditawarkan = standar + extra bed teralokasi ───────────
const combos = buildRoomCombinationRecommendations(options, 7);
assert.ok(combos.length > 0, "harus ada kombinasi untuk 7 tamu");
for (const combo of combos) {
  assert.equal(combo.total_kapasitas_ditawarkan, 7, `kombinasi ${JSON.stringify(combo.kamar.map((k) => k.nama))} ditawarkan untuk 7`);
}
const threeDeluxe = combos.find((c) => c.kamar.length === 1 && c.kamar[0]!.room_type_id === "deluxe");
if (threeDeluxe) {
  assert.equal(threeDeluxe.total_extra_bed, 1);
  assert.equal(threeDeluxe.kamar[0]!.kapasitas_ditawarkan, 7, "3 Deluxe + 1 extra bed = 7, bukan 9");
}

// ── B: formatter tidak mengutip kapasitas teoretis ──────────────────────────
const raw = JSON.stringify({
  periode: "11–12 Des 2026",
  kamar: [{ room_type_id: "deluxe", nama: "Deluxe Room", kamar_tersedia: 3, cocok_untuk_jumlah_tamu: false }],
  rekomendasi_kombinasi_kamar: combos,
});
const reply = formatAvailabilityForGuestCount(raw, { adults: 7, children: 0, total: 7 })?.reply ?? "";
assert.match(reply, /7 tamu/);
assert.doesNotMatch(reply, /sampai (8|9) tamu/, "tidak boleh klaim 8/9 tamu");

// ── C: guard balasan LLM ────────────────────────────────────────────────────
const guardRooms = [
  { name: "Family Room 222", capacity: 4, extraBedCapacity: 2 },
  { name: "Deluxe Room", capacity: 2, extraBedCapacity: 1 },
  { name: "Single Room", capacity: 1, extraBedCapacity: 1 },
];
assert.equal(isInvalidCombinationLine("- Family Room 222 + Single Room + 1 extra bed", guardRooms, 7), true, "4+1+1 = 6 < 7");
assert.equal(isInvalidCombinationLine("- Family Room 222 + Deluxe Room", guardRooms, 7), true, "4+2 = 6 < 7");
assert.equal(isInvalidCombinationLine("- 3 kamar Deluxe Room + 1 extra bed: kapasitas sampai 7 tamu", guardRooms, 7), false);
assert.equal(isInvalidCombinationLine("- 3 kamar Deluxe Room + 1 extra bed: kapasitas sampai 9 tamu", guardRooms, 7), true, "klaim 9 salah");
assert.equal(isInvalidCombinationLine("- Family Room 222 + Deluxe Room + 1 extra bed", guardRooms, 7), false, "4+2+1 = 7");
const guarded = guardCombinationCapacity(
  "Pilihan untuk 7 orang:\n- Family Room 222 + Deluxe Room\n- Family Room 222 + Deluxe Room + 1 extra bed\nMau yang mana, Kak?",
  guardRooms,
  7,
);
assert.equal(guarded.removed, 1);
assert.doesNotMatch(guarded.text, /Deluxe Room\n/);
assert.match(guarded.text, /\+ 1 extra bed/);

// ── D: "boleh kak" atas tawaran foto → kirim foto ───────────────────────────
const offer = "Family Room 222 cocok untuk 4 orang. Mau saya kirimkan foto Family Room 222, Kak?";
assert.equal(
  photoOfferAcceptanceText([
    { direction: "out", body: offer },
    { direction: "in", body: "boleh kak" },
  ]),
  offer,
);
assert.equal(
  photoOfferAcceptanceText([
    { direction: "out", body: offer },
    { direction: "in", body: "nggak usah kak" },
  ]),
  null,
);
assert.equal(
  photoOfferAcceptanceText([
    { direction: "out", body: "Untuk berapa orang, Kak?" },
    { direction: "in", body: "boleh kak" },
  ]),
  null,
);

// ── Asumsi checkout disebutkan ──────────────────────────────────────────────
const noted = appendCheckoutAssumedNote("Ada kamar, Kak.", "2026-12-12");
assert.match(noted, /checkout 12\/12\/2026/);
assert.equal(appendCheckoutAssumedNote(noted, "2026-12-12"), noted, "tidak dobel");

console.log("✓ Sofiah combination/photo/checkout regressions passed");
