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
const unnes = hits("jauh ga dari unnes?", "faq_distance");
assert.ok(unnes.includes("4,5 km"));
assert.ok(!unnes.includes("8 km"));
assert.ok(hits("berapa menit ke simpang lima?", "faq_distance").length > 0);
assert.ok(hits("jauh dari bandara ahmad yani?", "faq_distance").includes("9 km"));
assert.ok(hits("berapa menit ke stasiun poncol?", "faq_distance").includes("7 km"));
assert.ok(hits("dekat stasiun tawang ga?", "faq_distance").includes("20–25 menit"));
assert.ok(hits("jarak ke lawang sewu?", "faq_distance").includes("6 km"));
assert.ok(hits("jauh ga dari undip tembalang?", "faq_distance").includes("9,5 km"));

// OTA
assert.ok(hits("di agoda lebih murah ya?", "faq_ota").toLowerCase().includes("ota"));
const otaBed = hits("kalau order via airbnb bisa extra bed?", "faq_ota_extra_bed");
assert.ok(!/Rp\s?\d/.test(otaBed), "fast-path OTA tidak boleh menyebut tarif extra bed statis");

// Cara booking
assert.ok(hits("booking online gapapa kak?", "faq_booking_method").toLowerCase().includes("whatsapp"));
assert.ok(hits("harus datang ke tempat ya?", "faq_booking_method").length > 0);

// Nego yang tidak berlanjut harus ditutup sopan, bukan membuka ulang booking.
const negotiationClosed = hits(
  "Maaf kak untuk segitu harga masih belum cocok, kalau saya boleh nego di harga 120 ribu kalau boleh, kalau tidak juga tidak apa apa terima kasih🙏",
  "negotiation_closed",
  "early",
);
assert.ok(negotiationClosed.includes("harga terbaik"));
assert.ok(negotiationClosed.includes("Terima kasih sudah mempertimbangkan"));
assert.ok(!/berapa orang|bantu booking|pesan sekarang/i.test(negotiationClosed));

fallsThrough(
  "boleh nego sedikit kak?",
  "nego yang masih terbuka tetap harus dijawab memakai harga live",
  "early",
);

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
// Tarif extra bed tidak lagi di-hardcode: ikut room_types / kalender harga.
assert.ok(!/extra bed[^.]*Rp\s?100\.000/i.test(prompt), "tarif extra bed statis masih ada di prompt");
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

// Nama hari adalah tanggal menginap, bukan pertanyaan jam check-in.
fallsThrough(
  "Check in Sabtu sore Minggu pagi checkout",
  "nama hari menandai tanggal menginap",
);
assert.equal(ask("jam berapa check in nya kak?")?.intent, "policy_question");

const oct8 = frontOfficeAgent.buildSystemPrompt({
  property: PROPERTY,
  rooms: ROOMS,
  sopText: "",
  today: "2026-10-08",
  intent: "availability_check",
} as unknown as AgentContext);
assert.ok(oct8.includes("Hari ini Kamis, 8 Oktober 2026 (WIB)"), "baris hari ini menyertakan nama hari");
assert.ok(oct8.includes("Jumat 9 Okt"), "kalender 7 hari mulai besok");
assert.ok(oct8.includes("Sabtu 10 Okt"));
assert.ok(/Sabtu depan/.test(oct8) && /jangan menebak|JANGAN menebak/i.test(oct8));
assert.ok(oct8.includes("Sabtu–Minggu, 10–11 Oktober 2026"));

const generalDay = frontOfficeAgent.buildSystemPrompt({
  property: PROPERTY,
  rooms: ROOMS,
  sopText: "",
  today: "2026-10-08",
  intent: "general",
  lastMessage: "Sabtu malam Minggu ada kamar?",
} as unknown as AgentContext);
assert.ok(
  generalDay.includes("KETERSEDIAAN KAMAR — ATURAN TANGGAL"),
  "intent general + nama hari tetap membawa konteks ketersediaan",
);
const generalTools = (frontOfficeAgent.getTools?.({
  property: PROPERTY,
  rooms: ROOMS,
  sopText: "",
  today: "2026-10-08",
  intent: "general",
  lastMessage: "Sabtu malam Minggu ada kamar?",
} as unknown as AgentContext) ?? []).map((t) => t.function.name);
assert.ok(generalTools.includes("check_room_availability"));
assert.ok(generalTools.includes("send_room_photos"));
assert.ok(generalTools.includes("offer_alternative_rooms"));

const lite = frontOfficeAgent.buildSystemPrompt({
  property: PROPERTY,
  rooms: ROOMS,
  sopText: "",
  today: "2026-10-08",
  intent: "general",
} as unknown as AgentContext);
assert.ok(/jangan arahkan ke website atau Instagram untuk foto/i.test(lite));
assert.ok(/panggil send_room_photos/i.test(lite));

// Tamu sudah tiba & tidak ada yang jaga → bel di pintu masuk (Faizal 28 Okt 2026)
{
  const { buildPropertyFaqReply: faq, ARRIVAL_BELL_REPLY } = await import("../src/services/property-faq");
  for (const m of [
    "Kak saya sudah sampai tapi tidak ada yang jaga",
    "udah nyampe kok sepi ga ada orang",
    "kak kok gak ada yang jaga ya",
    "saya sudah di depan, pintunya dikunci",
    "sudah tiba tapi gak bisa masuk",
    "resepsionis kosong kak",
  ]) {
    for (const mode of ["early", "late"] as const) {
      const r = faq({ message: m, property: PROPERTY as any, rooms: [], mode });
      assert.equal(r?.intent, "arrival_ring_bell", `${mode}: ${m}`);
      assert.equal(r?.reply, ARRIVAL_BELL_REPLY);
    }
  }
  assert.ok(/pintu masuk/.test(ARRIVAL_BELL_REPLY) && /bel/.test(ARRIVAL_BELL_REPLY));
  for (const m of ["ada kamar kosong tanggal 5?", "check in jam berapa?", "sudah sampai mana kak prosesnya"]) {
    assert.notEqual(faq({ message: m, property: PROPERTY as any, rooms: [], mode: "late" })?.intent, "arrival_ring_bell", m);
  }
}

// ═══ Lokasi: Dewi Sartika, BUKAN Lumbung (30 Okt 2026) ═══════════════════════
{
  const { ensureLocationCorrection, POMAH_ADDRESS, WRONG_LOCATION_CORRECTION } = await import("../src/services/property-faq");
  assert.equal(POMAH_ADDRESS, "Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50221");
  for (const m of ["alamatnya dimana kak?", "lokasi pomah di lumbungsari ya?", "share maps dong"]) {
    const r = hits(m, "location_question");
    assert.ok(r.includes(POMAH_ADDRESS), m);
    assert.ok(!/lumbung/i.test(r) || /bukan di Lumbungsari/.test(r), m);
  }
  const inbound = "Halo kaa. Untuk Pomah Guest House Lumbungsari Raya utk tgl 31 Des-4 Jan 2027 tipe family room apakah masih avail?";
  const fixed = ensureLocationCorrection("Masih ada, Kak. Family Room tersisa 1 unit.", inbound);
  assert.ok(fixed.startsWith(WRONG_LOCATION_CORRECTION));
  assert.equal(ensureLocationCorrection("Masih ada, Kak.", "ada kamar tgl 5?"), "Masih ada, Kak.");
  const bad = ensureLocationCorrection("Betul Kak, kami di Lumbungsari Raya. Kamar masih ada.", "lokasi?");
  assert.ok(!/lumbung/i.test(bad), bad);
  const { readFileSync } = await import("node:fs");
  assert.ok(readFileSync("src/ai/agents/front-office.agent.ts", "utf8").includes("Pomah TIDAK berada di Lumbung"));
}

console.log(
  `✓ property FAQ fast-path regressions passed — ` +
    `6 topik baru dijawab tanpa token, ${KNOWN_LANDMARKS.length} landmark tersinkron dengan prompt`,
);

// ═══ F. Tempat terdekat (nearby-places.ts) ═══════════════════════════════════
{
  const { NEARBY_CATEGORIES } = await import("../src/services/nearby-places");
  // Pertanyaan asli dari log WA 30 Okt 2026.
  const real = hits("untuk di dekat penginapan apakah ada warung atau minimarket kak?", "faq_nearby_place");
  assert.ok(/Alfamart/.test(real) && /Indomaret/.test(real), real);
  assert.ok(/^• Indomaret terdekat — sekitar 250 m, kurang lebih 3 menit jalan kaki/m.test(real) && real.indexOf("Indomaret terdekat") < real.indexOf("Alfamart"), real);
  const atm = hits("ada atm dekat sini?", "faq_nearby_place");
  assert.ok(atm.indexOf("ATM BCA") < atm.indexOf("ATM Bank Mandiri") && atm.indexOf("ATM Bank Mandiri") < atm.indexOf("ATM BNI"), atm);
  assert.ok(/ATM BCA — sekitar 400 m, kurang lebih 5 menit jalan kaki/.test(atm) && !/di Indomaret/.test(atm), atm);
  for (const [m, re] of [
    ["indomaret terdekat dimana kak?", /Indomaret/],
    ["ada atm dekat sini?", /ATM BNI/],
    ["apotek terdekat?", /Apotek Viva Generik/],
    ["masjid terdekat dimana ya kak", /Nurul Ilmi/],
    ["kalau mau ke klinik terdekat?", /Klinik Pratama/],
    ["spbu terdekat?", /SPBU/],
    ["gereja dekat sini ada?", /GKJ/],
    ["halte brt terdekat dimana kak?", /Halte BRT Sampangan Timur — sekitar 100 m, kurang lebih 1–2 menit jalan kaki/],
    ["naik trans semarang dari mana kak?", /Halte BRT Sampangan Timur/],
    ["ada bus dekat sini?", /Halte BRT Sampangan Timur/],
    ["transportasi umum gimana kak?", /Halte BRT Sampangan Timur/],
  ] as const) assert.ok(re.test(hits(m, "faq_nearby_place")), m);
  // Kategori di luar daftar & pertanyaan ketersediaan tetap ke AI.
  assert.equal(ask("laundry terdekat dimana kak?"), null, "laundry harus ke AI, bukan alamat");
  for (const m of ["laundry terdekat dimana kak?", "mall cafe atau apapun itu", "ada kamar tgl 5? dekat indomaret gak?"]) {
    assert.notEqual(ask(m)?.intent, "faq_nearby_place", m);
  }
  for (const m of ["stasiun poncol jauh ga kak?", "ke bandara berapa menit?", "terminal bus terdekat?"]) {
    assert.notEqual(ask(m)?.intent, "faq_nearby_place", m);
  }
  assert.equal(ask("stasiun poncol jauh ga kak?")?.intent, "faq_distance");
  assert.equal(ask("ke bandara berapa menit?")?.intent, "faq_distance");
  assert.ok(!/koridor/i.test(hits("halte brt terdekat?", "faq_nearby_place")));
  assert.ok(prompt.includes("Alfamart Sampangan") && prompt.includes("kami cek terlebih dahulu"), "daftar tempat terdekat hilang dari prompt");
  for (const c of NEARBY_CATEGORIES) for (const p of c.places) assert.ok(/^sekitar /.test(p.distance), p.name);
  assert.equal(hits("ke unika berapa menit kak?", "faq_distance").includes("2,8 km"), true);
}
