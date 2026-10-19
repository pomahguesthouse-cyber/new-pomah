import assert from "node:assert/strict";
import { stripEchoedGuestQuestions, stripUnrequestedPriceList, trimHistoryAtGap } from "../src/services/wa-autoreply/reply-relevance";

// Azaaa 16 Okt 17:06: bot menyalin pertanyaan tamu dari 13 Okt
const azaReply =
  "Baik Kak. Untuk booking PG-HJ5MF, harga kamar Single per malamnya tetap Rp 150.000 ya, Kak. Tidak ada perbedaan harga meskipun Kakak tiba di malam hari.\n\n" +
  "Kalau boleh tahu, ke UNNES berapa menit ya Kak? Lalu terminal dan stasiun terdekat dari Pomah Guesthouse apa ya, Kak?";
const azaPrior = ["Kalau boleh tau\n1. Ke unnes berapa menit ya kak?\n2. ⁠Terminal dan stasiun terdekat dari homestay apa ya kak?"];
const cleaned = stripEchoedGuestQuestions(azaReply, azaPrior);
assert.ok(!/UNNES berapa menit/i.test(cleaned), cleaned);
assert.ok(!/stasiun terdekat/i.test(cleaned), cleaned);
assert.match(cleaned, /Rp 150\.000/);

// Konfirmasi tanpa kata tanya tidak dihapus
assert.equal(
  stripEchoedGuestQuestions("Untuk Deluxe tanggal 20 untuk 2 orang ya Kak?", ["Deluxe tanggal 20 untuk 2 orang ada?"]),
  "Untuk Deluxe tanggal 20 untuk 2 orang ya Kak?",
);

// Ika PG-GDWES 17 Okt 19:13: "Ditunggu ya kk" → daftar harga tak diminta
const ikaReply =
  "Baik Kak, ini daftar harga kamar per malam di Pomah Guesthouse:\n\n• Single: Rp 150.000\n• Deluxe: Rp 230.000\n• Grand Deluxe: Rp 300.000\n• Family Suite 100: Rp 500.000\n• Family Room 222: Rp 500.000\n\n" +
  "Untuk tanggal 7-8 November 2026, Family Room 222 sudah Kakak amankan di kode booking PG-GDWES ya.";
const ika = stripUnrequestedPriceList(ikaReply, "Ditunggu ya kk");
assert.ok(!/Rp 230\.000|daftar harga/.test(ika), ika);
assert.match(ika, /PG-GDWES/);
// Diminta → tetap
assert.equal(stripUnrequestedPriceList(ikaReply, "harga kamarnya berapa aja kak?"), ikaReply);

// Riwayat dipotong di jeda > 12 jam
const msgs = [
  { direction: "in", body: "ke unnes berapa menit?", sent_at: "2026-10-13T09:28:00Z" },
  { direction: "out", body: "10–15 menit", sent_at: "2026-10-13T09:29:00Z" },
  { direction: "in", body: "Halo kak", sent_at: "2026-10-16T10:05:00Z" },
  { direction: "in", body: "harganya sama?", sent_at: "2026-10-16T10:05:10Z" },
];
assert.deepEqual(trimHistoryAtGap(msgs).map((m) => m.body), ["Halo kak", "harganya sama?"]);
assert.equal(trimHistoryAtGap(msgs.slice(2)).length, 2);

console.log("✓ reply relevance: tanpa pertanyaan lama tamu, tanpa daftar harga tak diminta");
