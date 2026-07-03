/**
 * Regression script untuk fast-path FAQ deterministik chatbot.
 *
 * Sejak konsolidasi O3 (3 Jul 2026), test ini MENGIMPOR builder asli
 * (`buildPropertyFaqReply` di src/services/property-faq.ts) — tidak ada lagi
 * salinan regex manual yang bisa drift dari produksi.
 *
 * Jalankan: npx tsx scripts/test-chatbot-fastpath.ts
 */

import { buildPropertyFaqReply } from "../src/services/property-faq";

const PROPERTY: Record<string, unknown> = {
  name: "Pomah Guesthouse",
  address: "Jl. Contoh 1, Ambarawa",
  whatsapp_number: "+6281200000000",
  email: "hi@pomah.id",
  instagram_url: "https://ig.com/pomah",
  check_in_time: "14:00:00",
  check_out_time: "12:00:00",
};

const ROOMS = [
  { name: "Deluxe", amenities: ["AC", "WI-FI", "Shower"] },
  { name: "Grand Deluxe", amenities: ["AC", "WIfi", "Shower", "Bathtub"] },
];

type Case = {
  label: string;
  input: string;
  expectIntent: string | null;
  mode?: "early" | "late";
};

const CASES: Case[] = [
  { label: "greeting halo", input: "Halo kak", expectIntent: "greeting" },
  { label: "greeting selamat pagi", input: "selamat pagi", expectIntent: "greeting" },
  { label: "thanks", input: "makasih ya kak", expectIntent: "thanks" },
  { label: "thanks siap", input: "siap", expectIntent: "thanks" },
  { label: "thanks dgn interjeksi", input: "Yahh, oke kak makasih ya", expectIntent: "thanks" },
  { label: "thanks banyak + emoji", input: "makasih banyak yaa 🙏", expectIntent: "thanks" },
  { label: "thanks oke deh", input: "oke deh makasih min", expectIntent: "thanks" },
  { label: "greeting dgn interjeksi", input: "oh iya, halo kak", expectIntent: null },
  { label: "oke lanjut booking (bukan thanks)", input: "oke, jadi booking deluxe ya", expectIntent: null },
  { label: "alamat", input: "alamatnya dimana?", expectIntent: "location_question" },
  { label: "lokasi maps", input: "share maps dong", expectIntent: "location_question" },
  { label: "kontak wa", input: "nomor wa berapa?", expectIntent: "contact_request" },
  { label: "kontak instagram", input: "IG kalian apa?", expectIntent: "contact_request" },
  { label: "jam check-in", input: "jam checkin jam berapa?", expectIntent: "policy_question" },
  { label: "jam check-out", input: "checkout jam brp", expectIntent: "policy_question" },
  { label: "wifi", input: "ada wifi ga?", expectIntent: "faq_wifi" },
  { label: "parkir", input: "parkir mobil bisa?", expectIntent: "faq_parking" },
  { label: "fasilitas perbandingan", input: "beda deluxe sama grand deluxe di fasilitas apa?", expectIntent: "faq_facility" },
  // Guard tanggal: jawaban tanggal yang memuat "checkout" bukan pertanyaan policy
  {
    label: "jawaban tanggal + kata checkout (bukan policy)",
    input: "Ini kak, menginapnya di tgl 7 siang/sore trs tgl 8 pagi/siang udh checkout",
    expectIntent: null,
  },
  // Negatif umum
  { label: "booking (bukan FAQ)", input: "mau booking kamar untuk besok", expectIntent: null },
  { label: "pertanyaan bebas", input: "boleh bawa hewan peliharaan?", expectIntent: null },
  // Guard komplain
  { label: "komplain wifi (bukan FAQ)", input: "wifi nya lemot banget min", expectIntent: null },
  { label: "komplain + minta kontak (bukan FAQ)", input: "AC rusak, minta kontak admin dong", expectIntent: null },
  { label: "komplain parkir (bukan FAQ)", input: "mobil saya baret di area parkir", expectIntent: null },
  { label: "denda telat checkout (bukan FAQ)", input: "kalau telat checkout kena denda?", expectIntent: null },
  // Mode early: blocklist kata booking aktif agar availability path menang
  { label: "early: halo + ada kamar → lolos ke availability", input: "halo, ada kamar ga?", expectIntent: null, mode: "early" },
  { label: "early: greeting murni tetap dijawab", input: "halo kak", expectIntent: "greeting", mode: "early" },
  // O5: pesan panjang multi-intent tidak boleh ditelan branch satu-baris
  {
    label: "O5: wifi dalam pesan panjang (bukan FAQ)",
    input: "ada wifi ga di kamarnya? terus saya juga mau tanya soal sarapan sama antar jemput dari stasiun bisa tidak",
    expectIntent: null,
  },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const res = buildPropertyFaqReply({
    message: c.input,
    property: PROPERTY,
    rooms: ROOMS,
    greetingUsed: false,
    mode: c.mode ?? "late",
  });
  const got = res?.intent ?? null;
  if (got === c.expectIntent) {
    pass++;
    console.log(`  ✓ ${c.label} → ${got ?? "(no-match)"}`);
  } else {
    fail++;
    console.error(`  ✗ ${c.label} — expected ${c.expectIntent ?? "(no-match)"}, got ${got ?? "(no-match)"}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
