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

// Alternatif: 2 Deluxe + 1 Single dengan 2 extra bed (1 di Single, 1 di Deluxe) = 7, bukan 8.
const mixed = combos.find(
  (c) => c.kamar.some((k) => k.room_type_id === "deluxe" && k.jumlah_kamar === 2) && c.kamar.some((k) => k.room_type_id === "single"),
);
assert.ok(mixed, "alternatif 2 Deluxe + Single harus ada");
assert.equal(mixed.total_kapasitas_ditawarkan, 7, "2 Deluxe + Single + extra bed = 7, bukan 8");
assert.equal(mixed.total_extra_bed, 2);
assert.equal(
  mixed.kamar.reduce((sum, k) => sum + k.kapasitas_ditawarkan, 0),
  7,
  "jumlah kapasitas per baris = 7",
);
// Harga extra bed mengikuti tarif input (dari DB/kalender), bukan angka tetap.
assert.equal(
  mixed.total_per_malam,
  2 * 225000 + 150000 + 2 * 100000,
);

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

// Nama tipe kamar sesuai database produksi + penulisan bebas LLM.
const dbRooms = [
  { name: "Deluxe", capacity: 2, extraBedCapacity: 1 },
  { name: "Family Room 222", capacity: 4, extraBedCapacity: 2 },
  { name: "Family Suite 100", capacity: 4, extraBedCapacity: 2 },
  { name: "Grand Deluxe", capacity: 2, extraBedCapacity: 1 },
  { name: "Single", capacity: 1, extraBedCapacity: 1 },
];
assert.equal(isInvalidCombinationLine("Bisa pakai Family+Single+1 extra bed", dbRooms, 7), true, "Family+Single+1 EB = 6");
assert.equal(isInvalidCombinationLine("atau Family Room + Deluxe", dbRooms, 7), true, "Family+Deluxe = 6");
assert.equal(isInvalidCombinationLine("- 1 Family Suite 100 + 1 Grand Deluxe", dbRooms, 7), true);
assert.equal(isInvalidCombinationLine("- 3 Deluxe + 1 extra bed (cukup untuk 7 orang)", dbRooms, 7), false);
assert.equal(isInvalidCombinationLine("- 3 Deluxe + 1 extra bed, kapasitas 9", dbRooms, 7), true);
assert.equal(isInvalidCombinationLine("Family + 2 extra bed + Single", dbRooms, 7), false, "4+1+2 = 7");
assert.equal(isInvalidCombinationLine("Family Room 222 untuk 4 orang", dbRooms, 7), false, "bukan baris kombinasi");

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

// ═══ Integrasi finalReply: applyCombinationGuardToReply (dipanggil service) ═══
import {
  applyCombinationGuardToReply,
  capacityGuardFallbackReply,
} from "../src/services/wa-autoreply/combination-capacity-guard";
import { dispatchOfferAcceptance } from "../src/services/wa-autoreply/offer-acceptance";

const dbRoomRows = [
  { name: "Deluxe", capacity: 2, extrabed_capacity: 1 },
  { name: "Family Room 222", capacity: 4, extrabed_capacity: 2 },
  { name: "Family Suite 100", capacity: 4, extrabed_capacity: 2 },
  { name: "Grand Deluxe", capacity: 2, extrabed_capacity: 1 },
  { name: "Single", capacity: 1, extrabed_capacity: 1 },
];
const stateSlots = { checkIn: "2026-12-11", checkOut: "2026-12-12", checkoutAssumed: true, partialAdults: 7 };
const guardFinal = (reply: string, slots: Record<string, unknown> = stateSlots, inbound: string[] = []) =>
  applyCombinationGuardToReply({ reply, rooms: dbRoomRows, slots, inboundBodies: inbound });

// 1) Satu baris invalid saja → fallback aman (bukan teks asli invalid).
const single = guardFinal("Bisa pakai Family + Deluxe ya Kak.");
assert.equal(single.fallback, true);
assert.equal(single.text, capacityGuardFallbackReply(7));
assert.doesNotMatch(single.text, /Rp|booking|Family/i, "fallback tanpa harga/booking/opsi");

// 2) Paragraf dua opsi invalid dalam satu baris → fallback.
const twoOpts = guardFinal(
  "Untuk 7 orang bisa Family Room 222 + Single + 1 extra bed atau Family Room 222 + Deluxe, mau yang mana Kak?",
);
assert.equal(twoOpts.fallback, true);
assert.equal(twoOpts.text, capacityGuardFallbackReply(7));

// 3) Campuran valid + invalid → hanya invalid yang dibuang, tidak fallback.
const mixedReply = guardFinal(
  "Pilihan untuk 7 orang:\n- 3 Deluxe + 1 extra bed\n- Family + Deluxe\n- Family + 1 extra bed + Single + 1 extra bed\nMau yang mana, Kak?",
);
assert.equal(mixedReply.removed, 1);
assert.equal(mixedReply.fallback, false);
assert.match(mixedReply.text, /3 Deluxe \+ 1 extra bed/);
assert.match(mixedReply.text, /Family \+ 1 extra bed \+ Single \+ 1 extra bed/, "2 klausa EB: 4+1+2 = 7");
assert.doesNotMatch(mixedReply.text, /- Family \+ Deluxe\n/);

// 4) Beberapa klausa extra bed & angka berulang tidak salah parse.
assert.equal(guardFinal("- 3 Deluxe + 1 extra bed, kapasitas 7\n- lainnya").removed, 0, "3 Deluxe + 1 EB = 7");
assert.equal(guardFinal("- 3 Deluxe + 1 extra bed: kapasitas 9 tamu").fallback, true, "klaim 9 untuk 3 Deluxe + 1 EB ditolak");
assert.equal(guardFinal("- 3 Deluxe + 3 extra bed: kapasitas 9 tamu").removed, 0, "3 EB berulang = 9, klaim cocok");
assert.equal(guardFinal("- 2 Deluxe + 1 extra bed + Single + 1 extra bed (kapasitas 7)").removed, 0, "2 EB berulang = 7");
assert.equal(guardFinal("- 2 Deluxe + 1 extra bed + Single + 1 extra bed (kapasitas 8)").fallback, true, "bukan 8");

// 5) Ejaan bebas vs DB: "family room", "FAMILY", "grand deluxe".
assert.equal(guardFinal("Bisa FAMILY ROOM + single + 1 extra bed").fallback, true);
assert.equal(guardFinal("Bisa 1 Family Suite 100 + 1 Grand Deluxe").fallback, true, "4+2 = 6");

// 6) Jumlah tamu dari slot partialAdults=7; tanpa slot → dari pesan "untuk 7 orang kk".
assert.equal(guardFinal("Family + Deluxe", {}, ["untuk 7 orang kk"]).fallback, true);
assert.equal(guardFinal("Family + Deluxe", {}, []).removed, 0, "tanpa jumlah tamu guard tidak menebak");
assert.equal(guardFinal("Family + Deluxe", { partialAdults: 6 }).removed, 0, "6 tamu: Family + Deluxe cukup");

// ═══ Media: "boleh kak" setelah tawaran foto Family → dispatch dokumen brosur PDF (mock transport) ═══
const sent: Array<{ phone: string; caption: string; fileUrl: string; filename: string }> = [];
const mockDeps = {
  loadBrochure: async () => ({ name: "brosur-pomah.pdf", url: "https://example.test/brosur-pomah.pdf" }),
  sendDocument: async (phone: string, caption: string, opts: { fileUrl: string; filename: string }) => {
    sent.push({ phone, caption, ...opts });
    return { ok: true };
  },
};
const photoOfferHistory = [
  { direction: "in", body: "kalau family gimana kak" },
  { direction: "out", body: "Family Room 222 muat 4 orang + 2 extra bed. Mau saya kirimkan foto Family Room 222, Kak?" },
];
const accepted = await dispatchOfferAcceptance([...photoOfferHistory, { direction: "in", body: "boleh kak" }], "6281200000000", mockDeps);
assert.equal(accepted?.status, "sent");
assert.equal(sent.length, 1, "tepat satu dokumen dikirim");
assert.match(sent[0]!.fileUrl, /\.pdf$/);
assert.equal(sent[0]!.filename, "brosur-pomah.pdf");

const declined = await dispatchOfferAcceptance([...photoOfferHistory, { direction: "in", body: "nggak usah kak" }], "6281200000000", mockDeps);
assert.equal(declined, null);
assert.equal(sent.length, 1, "'nggak usah' tidak dispatch");

const notOffer = await dispatchOfferAcceptance(
  [{ direction: "out", body: "Untuk berapa orang, Kak?" }, { direction: "in", body: "boleh kak" }],
  "6281200000000",
  mockDeps,
);
assert.equal(notOffer, null);
assert.equal(sent.length, 1, "tanpa tawaran media tidak dispatch");

const failed = await dispatchOfferAcceptance(
  [...photoOfferHistory, { direction: "in", body: "boleh" }],
  "6281200000000",
  { ...mockDeps, sendDocument: async () => ({ ok: false, error: "mock gagal" }) },
);
assert.equal(failed?.status, "failed", "kegagalan kirim dilaporkan, bukan dianggap terkirim");

console.log("✓ Sofiah integration (finalReply guard + brochure dispatch) passed");
