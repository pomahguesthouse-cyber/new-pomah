/** Regresi insiden Azzra Raditya (29 Okt–1 Nov 2026). Tanpa jaringan/DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPropertyFaqReply } from "../src/services/property-faq";
import { findAcceptedOffer, isOfferAcceptance, isBookingOffer, extractOfferDetails } from "../src/ai/state-machine/offer-acceptance";
import { parseCompleteReply, isTruncatedFinish } from "../src/ai/reply-integrity";

const ROOMS = ["Single", "Deluxe", "Grand Deluxe", "Family Suite 100", "Family Room 222"].map((name) => ({ name }));
const TODAY = "2026-10-30";
const OFFER =
  "Untuk Family Room 222 periode 10–15 November 2026 (5 malam), tarifnya Rp 500.000 per malam dengan total Rp 2.500.000.\n\n" +
  "Kamar ini berkapasitas standar 4 orang. Karena menginap 5 malam, Kakak bisa memilih opsi DP 50% atau pembayaran lunas via transfer bank. " +
  "Mau kami bantu proses pemesanannya sekarang, Kak?";

// 1) "kode booking dimana" bukan pertanyaan lokasi.
for (const mode of ["early", "late"] as const) {
  for (const message of [
    "untuk kode booking nya dimana ya kak?",
    "bayarnya dimana kak?",
    "transfer kemana ya kak? norek dimana",
    "tagihannya dimana kak",
    "untuk dp nya dimana ya",
  ]) {
    assert.notEqual(buildPropertyFaqReply({ message, property: {}, mode })?.intent, "location_question", message);
  }
  for (const message of ["lokasinya dimana kak?", "alamat pomah dimana ya", "minta maps nya kak"]) {
    assert.equal(buildPropertyFaqReply({ message, property: {}, mode })?.intent, "location_question", message);
  }
}

// 2) Persetujuan tawaran → booking dari tawaran terakhir.
assert.ok(isBookingOffer(OFFER));
assert.ok(!isBookingOffer("Tarif Family Room 222 Rp500.000/malam."));
for (const yes of [
  "iya kak", "oke", "jadi kak", "mau proses", "mau bayar", "saya ingin bayar hari ini",
  "oke kak bagaimana kalo kita bayar lunas besok sabtu kak, mengetahui bahwa tujuan kami adalah lomba",
  "boleh kak lanjut", "bayar di tempat ya kak",
]) assert.ok(isOfferAcceptance(yes), yes);
for (const no of [
  "oke kak coba saya diskusikan bersama tim saya terlebih dahulu",
  "tidak jadi kak", "belum kak", "kak apakah disana menyediakan rice cooker ??", "untuk kode booking nya dimana ya kak?",
  "iya kak jadi gimana?",
]) assert.ok(!isOfferAcceptance(no), no);

const expected = { roomName: "Family Room 222", quantity: 1, checkIn: "2026-11-10", checkOut: "2026-11-15" };
assert.deepEqual(extractOfferDetails(OFFER, ROOMS, TODAY), expected);
// Nama terpanjang menang: Grand Deluxe ≠ Deluxe.
assert.equal(extractOfferDetails("Grand Deluxe 12–13 November 2026 tersedia. Mau saya bantu proses?", ROOMS, TODAY)?.roomName, "Grand Deluxe");
// Dua tipe kamar → ambigu → biar AI yang tanya.
assert.equal(extractOfferDetails("Deluxe atau Single 12–13 November 2026, mau saya bantu proses?", ROOMS, TODAY), null);

// 30 Okt 19.59: langsung setelah tawaran.
const thread = [
  { direction: "in", body: "kalo untuk family suite 100 yang 4 orang itu berapa kak?" },
  { direction: "out", body: "Untuk Family Suite 100 harga dasarnya mulai dari Rp 500.000 per malam." },
  { direction: "in", body: "iya kak jadi gimana?" },
  { direction: "out", body: OFFER },
  { direction: "in", body: "oke kak bagaimana kalo kita bayar lunas besok sabtu kak" },
];
assert.deepEqual(findAcceptedOffer(thread, ROOMS, TODAY), expected);

// 1 Nov 09.34: "saya ingin bayar hari ini" setelah obrolan lain → tetap pakai tawaran terakhir,
// bukan slot basi (Single, 31 Okt–7 Nov).
const later = [
  ...thread.slice(0, 4),
  { direction: "in", body: "oke baik kak terimakasih" },
  { direction: "out", body: "Sama-sama, Kak 🙏" },
  { direction: "in", body: "untuk di dekat penginapan apakah ada warung atau minimarket kak?" },
  { direction: "out", body: "dekat indomaret kak" },
  { direction: "in", body: "Pagii kakk" },
  { direction: "in", body: "saya ingin bayar hari ini" },
];
assert.deepEqual(findAcceptedOffer(later, ROOMS, "2026-11-01"), expected);
// "iya" tanpa tawaran di balasan terakhir tidak memicu booking.
assert.equal(findAcceptedOffer([...later.slice(0, 8), { direction: "in", body: "iya kak" }], ROOMS, "2026-11-01"), null);
// Tawaran yang tanggalnya sudah lewat tidak dipakai.
assert.equal(findAcceptedOffer(thread, ROOMS, "2026-11-12"), null);

// Orchestrator memanggil start_booking dengan kamar + tanggal tawaran, tanpa harga dari teks.
const orch = readFileSync(resolve(import.meta.dirname, "../src/ai/multi-agent-orchestrator.ts"), "utf8");
assert.ok(/findAcceptedOffer\(input\.messages/.test(orch));
const block = orch.slice(orch.indexOf("findAcceptedOffer(input.messages"), orch.indexOf("// 4. Context resolver"));
assert.ok(!/price_per_night/.test(block), "harga tidak boleh diambil dari teks tawaran");

// 3) Balasan terpotong tidak pernah dikirim.
assert.equal(parseCompleteReply("Halo Kak. Untuk tarif kamar harga dasarnya mulai dari:\n\n- Single: mulai dari", "MAX_TOKENS"), null);
assert.equal(parseCompleteReply('{"reply":"Baik Kak, untuk kamar Family Room 222 periode 10–15 November 2026 (5 malam)', "stop"), null);
assert.ok(isTruncatedFinish("length") && isTruncatedFinish("max_tokens") && !isTruncatedFinish("stop"));

console.log("Azzra booking-flow regressions passed");
