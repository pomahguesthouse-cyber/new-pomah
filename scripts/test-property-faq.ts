/**
 * Regresi fast-path FAQ properti — lever #6 audit anggaran token 26 Agu 2026.
 *
 * Setiap pertanyaan yang dijawab di sini TIDAK pernah menyentuh gateway: nol
 * token, nol latensi, dan jawabannya tidak bisa dikarang model. Tapi fast-path
 * yang salah menyala jauh lebih mahal daripada token yang dihematnya — jadi
 * porsi terbesar tes ini adalah kasus yang HARUS dilewatkan ke AI.
 *
 * Bagian D menjaga hal yang paling gampang rusak diam-diam: angka di fast-path
 * dan angka di prompt Front Office harus sama. Kalau salah satu diubah sendiri,
 * tamu bisa dapat dua jawaban berbeda tergantung pesannya kebetulan kena
 * fast-path atau tidak.
 */
import assert from "node:assert/strict";
import {
  buildPropertyFaqReply,
  parseRequestedHour,
  EARLY_LATE_HOURLY_FEE_IDR,
  EXTRA_BED_RATE_IDR,
  KNOWN_LANDMARKS,
} from "../src/services/property-faq";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext } from "../src/ai/agents/types";

const PROPERTY = {
  name: "Pomah Guesthouse",
  address: "Jl. Dewi Sartika IV no 71, Sampangan, Semarang",
  check_in_time: "14:00",
  check_out_time: "12:00",
  whatsapp_number: "6281227271799",
};
const ROOMS = [
  { name: "Single", base_rate: 250000, capacity: 2 },
  { name: "Deluxe", base_rate: 300000, capacity: 2 },
] as never[];

const ask = (message: string, mode: "early" | "late" = "late") =>
  buildPropertyFaqReply({ message, property: PROPERTY, rooms: ROOMS, mode, greetingUsed: true });

const hits = (message: string, intent: string, mode: "early" | "late" = "late") => {
  const r = ask(message, mode);
  assert.ok(r, `"${message}" seharusnya dijawab fast-path (${intent}), bukan diteruskan ke AI`);
  assert.equal(r.intent, intent, `"${message}" → intent salah`);
  return r.reply;
};
const fallsThrough = (message: string, why: string, mode: "early" | "late" = "late") =>
  assert.equal(ask(message, mode), null, `"${message}" harus diteruskan ke AI — ${why}`);

// ═══ A. Cabang baru menyala ══════════════════════════════════════════════════

// Early check-in / late check-out — kebijakan bertarif, termasuk hitungannya.
const early = hits("boleh early check in jam 9 pagi?", "early_late_checkin_policy");
assert.ok(early.includes("25.000"), "tarif per jam wajib disebut");
assert.ok(early.includes("5 jam"), "selisih jam dari 14.00 ke 09.00 = 5 jam");
assert.ok(early.includes("125.000"), "total 25.000 × 5 wajib dihitung, bukan diserahkan ke tamu");

const late = hits("bisa late check out jam 5 sore ga kak?", "early_late_checkin_policy");
assert.ok(late.includes("5 jam") && late.includes("125.000"), "12.00 → 17.00 = 5 jam");

// Tanpa jam yang jelas: tetap sebut tarifnya, jangan mengarang hitungan.
const noHour = hits("bisa masuk lebih awal ga kak?", "early_late_checkin_policy");
assert.ok(noHour.includes("25.000"));
assert.ok(!/×/.test(noHour), "tanpa jam jangan menampilkan perkalian");

// Jam standar (bukan early/late) tetap dijawab cabang lama, kini ikut menyebut tarif.
const standard = hits("jam berapa check in nya kak?", "policy_question");
assert.ok(standard.includes("14:00") && standard.includes("12:00"));
assert.ok(standard.includes("25.000"), "jawaban jam standar wajib konsisten soal tarif early/late");

// Sarapan
assert.ok(hits("ada sarapan ga kak?", "faq_breakfast").toLowerCase().includes("belum menyediakan sarapan"));

// Jarak ke landmark yang datanya pasti
const akpelni = hits("dekat akpelni ya kak?", "faq_distance");
assert.ok(akpelni.includes("AKPELNI") && akpelni.includes("5 menit"));
assert.ok(hits("jauh ga dari unnes?", "faq_distance").includes("8 km"));
assert.ok(hits("berapa menit ke simpang lima?", "faq_distance").length > 0);

// OTA
assert.ok(hits("di agoda lebih murah ya?", "faq_ota").toLowerCase().includes("ota"));
const otaBed = hits("kalau order via airbnb bisa extra bed?", "faq_ota_extra_bed");
assert.ok(otaBed.includes("100.000"), "tarif extra bed wajib disebut apa adanya");

// Cara booking
assert.ok(hits("booking online gapapa kak?", "faq_booking_method").toLowerCase().includes("whatsapp"));
assert.ok(hits("harus datang ke tempat ya?", "faq_booking_method").length > 0);

// Day-use / istirahat singkat — framing positif, bukan penolakan.
const dayUse = hits("bisa sewa per jam ga kak?", "faq_day_use");
assert.ok(/^.*bisa/i.test(dayUse), "jawaban day-use harus dibuka dengan solusi, bukan 'tidak bisa'");
assert.ok(dayUse.includes("12:00"));

// ═══ B. Yang HARUS tetap diteruskan ke AI ════════════════════════════════════

fallsThrough("ada kamar kosong tanggal 5 september?", "ini pertanyaan ketersediaan, bukan FAQ");
fallsThrough("mau booking deluxe tanggal 12 buat 2 orang", "permintaan booking sungguhan");
fallsThrough("dekat unnes ga? terus harga deluxe berapa", "pesan gabungan jarak + harga");
fallsThrough("sarapannya udah termasuk harga kamar belum?", "menyangkut harga — biar AI yang utuh");
fallsThrough("gimana cara booking deluxe buat tanggal 3?", "sudah menyebut tipe kamar + tanggal");
fallsThrough("dekat pasar johar ga kak?", "landmark di luar daftar — jangan mengarang jarak");
fallsThrough("ac kamarnya rusak kak", "keluhan tidak boleh dijawab template");
fallsThrough("tgl 8 udah check out kok", "sinyal tanggal = jawaban tamu, bukan tanya kebijakan");
fallsThrough("lokasi dimana? terus dekat unnes ga?", "dua pertanyaan dalam satu pesan");

// Mode "early" berjalan SEBELUM jalur availability — pesan yang mengandung kata
// booking/kamar wajib lewat dulu ke sana.
fallsThrough("booking online gapapa kak?", "mode early harus mendahulukan jalur availability", "early");
assert.ok(ask("ada sarapan ga kak?", "early"), "sarapan tidak menyentuh jalur availability, boleh dijawab early");

// ═══ C. Pembacaan jam ════════════════════════════════════════════════════════

assert.equal(parseRequestedHour("early check in jam 9 pagi", "in"), 9);
assert.equal(parseRequestedHour("check out jam 5 sore", "out"), 17);
assert.equal(parseRequestedHour("check out jam 5", "out"), 17, "arah 'out' membaca angka kecil sebagai sore");
assert.equal(parseRequestedHour("check in jam 9", "in"), 9, "arah 'in' membaca angka kecil sebagai pagi");
assert.equal(parseRequestedHour("pukul 17.00", "out"), 17);
assert.equal(parseRequestedHour("tidak ada jam di sini", "in"), null);
assert.equal(parseRequestedHour("jam 99", "in"), null);

// ═══ D. Angka fast-path == angka di prompt Front Office ══════════════════════
// Ini penjaga drift. Prompt disunting agent Lovable dari waktu ke waktu; kalau
// tarif atau jarak di sana berubah tanpa mengubah konstanta di property-faq.ts,
// tamu bisa dapat dua angka berbeda. Tes ini gagal sebelum itu sampai ke tamu.

const prompt = frontOfficeAgent.buildSystemPrompt({
  property: PROPERTY,
  rooms: ROOMS,
  sopText: "",
  today: "2026-08-26",
} as unknown as AgentContext);

const digits = (n: number) => n.toLocaleString("id-ID");
const inPrompt = (needle: string, what: string) =>
  assert.ok(
    prompt.replace(/Rp\s*/g, "Rp").includes(needle.replace(/Rp\s*/g, "Rp")),
    `"${needle}" (${what}) tidak ada di prompt Front Office — fast-path dan prompt sudah tidak sinkron`,
  );

inPrompt(digits(EARLY_LATE_HOURLY_FEE_IDR), "tarif early/late check-in per jam");
inPrompt(digits(EXTRA_BED_RATE_IDR), "tarif extra bed");
for (const l of KNOWN_LANDMARKS) {
  assert.ok(
    l.re.test(prompt),
    `landmark ${l.label} ada di fast-path tapi tidak disebut prompt — salah satunya sudah usang`,
  );
}
assert.ok(/BELUM menyediakan sarapan/i.test(prompt), "kebijakan sarapan hilang dari prompt");
assert.ok(/minimal 1 malam/i.test(prompt), "kebijakan minimal 1 malam hilang dari prompt");

// ═══ E. Cabang lama tetap hidup ══════════════════════════════════════════════

assert.equal(ask("halo kak")?.intent, "greeting");
assert.equal(ask("makasih ya kak")?.intent, "thanks");
assert.equal(ask("alamatnya dimana kak?")?.intent, "location_question");
assert.equal(ask("ada wifi?")?.intent, "faq_wifi");
assert.equal(ask("ada parkir?")?.intent, "faq_parking");

// Akhiran "-nya" lazim dipakai tamu; tanpa dukungan ini pertanyaan sesederhana
// "parkirnya luas?" tetap membakar satu giliran AI penuh.
assert.equal(ask("parkirnya luas?")?.intent, "faq_parking");
assert.equal(ask("wifinya kenceng?")?.intent, "faq_wifi");
assert.equal(ask("sarapannya ada?")?.intent, "faq_breakfast");
assert.equal(ask("kamar mandinya di dalam?")?.intent, "faq_private_bathroom");

console.log(
  `✓ property FAQ fast-path regressions passed — ` +
    `6 topik baru dijawab tanpa token, ${KNOWN_LANDMARKS.length} landmark tersinkron dengan prompt`,
);
