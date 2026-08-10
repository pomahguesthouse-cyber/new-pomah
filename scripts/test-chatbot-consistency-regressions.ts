/**
 * Regresi konsistensi chatbot — insiden 9 Agu 2026 (transcript 6281210853153).
 *
 * Percakapan yang memicu perbaikan ini:
 *   tamu: "apakah ada gambarnya kak?"
 *   bot : "Sebentar Kak, saya cekkan dulu ya."
 *   bot : "Maaf Kak, sistem sedang lambat ... ketik 'lanjut'"      ← buntu
 *   tamu: "yang ini bisa berapa orang ya"
 *   tamu: "harganya berapa ya ka"
 *   bot : "Baik Kak, kita kirimkan brosur ya Kak 📸 ..."           ← Front Office
 *   bot : "... kami belum bisa menampilkan gambar kamar ..."       ← Pricing Agent
 *
 * Empat cacat yang diuji di sini:
 *   1. permintaan media tidak dikenali router  → intent `media_request`
 *   2. permintaan media hilang di tengah burst → `burstWantsMedia`
 *   3. penyangkalan kapabilitas media          → `stripMediaCapabilityDenial`
 *   4. kata tunjuk ditebak jadi tipe kamar     → `entityAmbiguous`
 */
import assert from "node:assert/strict";
import { burstWantsMedia, isMediaRequest } from "../src/services/wa-autoreply/message-parsers";
import {
  deniesMediaCapability,
  stripMediaCapabilityDenial,
  cleanReplyBody,
} from "../src/services/reply-postprocess";
import { resolveContext } from "../src/ai/router/context-resolver";
import { RULES } from "../src/ai/router/intent-classifier";
import { ROUTING_MAP } from "../src/ai/router/agent-router";
import { FALLBACK_MESSAGE } from "../src/services/wa-autoreply/runtime-policy";
import {
  extractAllSlots,
  extractCompanionAdults,
} from "../src/ai/state-machine/flexible-slot-extractor";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext } from "../src/ai/agents/types";

// ─── 1. Deteksi permintaan media ─────────────────────────────────────────────

assert.equal(isMediaRequest("apakah ada gambarnya kak?"), true);
assert.equal(isMediaRequest("boleh minta fotonya?"), true);
assert.equal(isMediaRequest("ada brosur atau katalog?"), true);
assert.equal(isMediaRequest("ada videonya ga kak"), true);
assert.equal(isMediaRequest("bisa lihat virtual tour 360?"), true);
assert.equal(isMediaRequest("harganya berapa ya ka"), false);
assert.equal(isMediaRequest("mau booking untuk 2 orang"), false);

// ─── 2. Permintaan media tidak boleh hilang di tengah burst ──────────────────
// Ini inti insidennya: memeriksa HANYA pesan terakhir membuat permintaan foto
// tak terlihat, lalu turn dirutekan sebagai pertanyaan harga.
const burst = [
  { direction: "out", body: "Untuk tanggal 16 Oktober 2026 masih tersedia ..." },
  { direction: "in", body: "apakah ada gambarnya kak?" },
  { direction: "in", body: "yang ini bisa berapa orang ya" },
  { direction: "in", body: "harganya berapa ya ka" },
];
assert.equal(burstWantsMedia(burst), true);
assert.equal(
  isMediaRequest(burst[burst.length - 1].body),
  false,
  "pesan terakhir memang tidak menyebut media — justru itu sebabnya burst harus diperiksa",
);

// Burst berhenti di pesan bot: permintaan media dari sesi SEBELUM balasan bot
// sudah terjawab dan tidak boleh memaksa routing media lagi.
assert.equal(
  burstWantsMedia([
    { direction: "in", body: "ada fotonya kak?" },
    { direction: "out", body: "Baik Kak, kita kirimkan brosur ya Kak 📸" },
    { direction: "in", body: "harganya berapa ya ka" },
  ]),
  false,
);

// ─── 3. Router: media_request ada, berbobot cukup, dan mendarat di Front Office ─

const mediaRule = RULES.find((r) => r.category === "media_request");
assert.ok(mediaRule, "kategori intent media_request harus terdaftar");
const pricingRule = RULES.find((r) => r.category === "pricing_inquiry")!;
const availabilityRule = RULES.find((r) => r.category === "availability_check")!;
assert.ok(
  mediaRule!.weight > pricingRule.weight && mediaRule!.weight > availabilityRule.weight,
  "media_request harus mengalahkan pricing_inquiry & availability_check — kalau kalah, " +
    "permintaan foto kembali mendarat di Pricing Agent yang tidak punya send_room_photos",
);
assert.ok(
  mediaRule!.patterns.some((p) => p.test("apakah ada gambarnya kak?")),
  "pola media_request harus menangkap kalimat pemicu insiden",
);
assert.equal(ROUTING_MAP.media_request, "front-office");

// ─── 4. Penyangkalan kapabilitas media harus dibuang ─────────────────────────

const denial =
  "Mohon maaf Kak, untuk saat ini kami belum bisa menampilkan gambar kamar secara langsung. " +
  "Namun, saya bisa berikan deskripsi lengkapnya.";
assert.equal(deniesMediaCapability(denial), true);

const cleaned = stripMediaCapabilityDenial(denial);
assert.equal(cleaned.stripped, true);
assert.ok(
  !deniesMediaCapability(cleaned.text),
  "kalimat penyangkalan harus hilang setelah strip",
);
assert.ok(
  cleaned.text.includes("deskripsi lengkapnya"),
  "informasi yang berguna di kalimat lain harus tetap utuh",
);

// Varian lain yang pernah/berpotensi muncul.
for (const variant of [
  "Maaf Kak, kami tidak bisa mengirimkan foto kamar lewat chat ini.",
  "Sistem kami belum mendukung pengiriman foto ya Kak.",
  "Untuk saat ini video kamar belum bisa kami kirim.",
]) {
  assert.equal(deniesMediaCapability(variant), true, `harus terdeteksi: ${variant}`);
}

// Jangan over-trigger pada kalimat yang sah.
for (const safe of [
  "Baik Kak, kita kirimkan brosur ya Kak 📸",
  "Foto kamar sudah saya kirimkan ya Kak.",
  "Kamar ini belum bisa dibooking untuk tanggal tersebut.",
]) {
  assert.equal(deniesMediaCapability(safe), false, `tidak boleh terdeteksi: ${safe}`);
}

// cleanReplyBody (jalur kirim bersama worker WA + simulator) ikut menyaring.
assert.ok(!deniesMediaCapability(cleanReplyBody(denial)));

// ─── 5. Kata tunjuk tidak boleh ditebak jadi tipe kamar ──────────────────────

const rooms = [
  { id: "r1", name: "Single" },
  { id: "r2", name: "Deluxe" },
  { id: "r3", name: "Grand Deluxe" },
] as unknown as Parameters<typeof resolveContext>[2];

const ambiguous = resolveContext(
  "yang ini bisa berapa orang ya",
  { lastTopic: "availability", lastEntity: { kind: "room", id: "r3", label: "Grand Deluxe" }, slots: {} },
  rooms,
);
assert.equal(
  ambiguous.entityAmbiguous,
  true,
  "'yang ini' tanpa nama tipe kamar harus ditandai ambigu, bukan diasumsikan Grand Deluxe",
);
assert.equal(
  ambiguous.slots.roomLabel,
  undefined,
  "tipe kamar hasil tebakan tidak boleh dipersist ke slots — ia akan menular ke turn berikutnya",
);

// Tamu menyebut tipe kamarnya sendiri → tidak ambigu.
const explicit = resolveContext(
  "kalau Deluxe bisa berapa orang?",
  { lastTopic: "availability", lastEntity: { kind: "room", id: "r3", label: "Grand Deluxe" }, slots: {} },
  rooms,
);
assert.equal(explicit.entityAmbiguous, false);
assert.equal(explicit.entity?.label, "Deluxe");
assert.equal(explicit.slots.roomLabel, "Deluxe");

// Tidak ada warisan sama sekali → tidak ada yang bisa salah ditebak.
const noInheritance = resolveContext(
  "yang ini bisa berapa orang ya",
  { lastTopic: "availability", lastEntity: null, slots: {} },
  rooms,
);
assert.equal(noInheritance.entityAmbiguous, false);

// Rujukan posisional tetap dianggap menunjuk (bukan ambigu).
const positional = resolveContext(
  "yang paling murah bisa berapa orang?",
  { lastTopic: "availability", lastEntity: { kind: "room", label: "Grand Deluxe" }, slots: {} },
  rooms,
);
assert.equal(positional.entityAmbiguous, false);

// ─── 6. Fallback tidak boleh jadi jalan buntu ────────────────────────────────

assert.ok(
  !/lanjut/i.test(FALLBACK_MESSAGE),
  "fallback tidak boleh menyuruh tamu mengetik 'lanjut' — tidak ada handler untuk kata itu " +
    "dan bot tetap membalas sendiri beberapa detik kemudian",
);
assert.ok(
  !/data terakhir sudah saya simpan/i.test(FALLBACK_MESSAGE),
  "jangan mengklaim penyimpanan data yang tidak terlihat tamu",
);

// ─── 7. Jumlah tamu implisit & anti-repetisi pertanyaan ──────────────────────
//
// Transcript 10 Agu 2026 (Helmi Sungkar Baja):
//   bot : "Ada berapa orang yang akan menginap, Kak?"
//   tamu: "Bebas ngga ?"
//   bot : "Mohon maaf Kak, maksudnya bebas bagaimana ya?"      ← balik bertanya
//   tamu: "Bebas jumlah tamu" / "Ato bawa pacar"
//   bot : "... Berapa orang total yang akan menginap, Kak?"    ← pertanyaan ke-3
//
// "bawa pacar" adalah jawaban jumlah tamu yang sah (2 orang). Bot mengabaikannya
// lalu mengulang pertanyaan yang sama sampai tamu menyerah ("Halo kak").

assert.equal(extractCompanionAdults("Ato bawa pacar"), 2);
assert.equal(extractCompanionAdults("nginep sama istri"), 2);
assert.equal(extractCompanionAdults("mau bareng temen aja"), 2);
assert.equal(extractCompanionAdults("saya + pasangan"), 2);
assert.equal(extractCompanionAdults("berdua sama suami"), 2);

// Jamak / tidak tentu → JANGAN ditebak, jumlah pastinya harus ditanya.
assert.equal(extractCompanionAdults("bawa teman-teman"), undefined);
assert.equal(extractCompanionAdults("sama rombongan kantor"), undefined);
assert.equal(extractCompanionAdults("sama keluarga"), undefined);
assert.equal(extractCompanionAdults("bawa temen2 kuliah"), undefined);

// Bukan frasa pendamping sama sekali.
assert.equal(extractCompanionAdults("bebas ngga?"), undefined);
assert.equal(extractCompanionAdults("harga Deluxe berapa?"), undefined);
assert.equal(extractCompanionAdults("bawa mobil boleh?"), undefined);

// Anak punya jalur ekstraksi + kebijakan usia sendiri — jangan jadi "+1 dewasa".
assert.equal(extractCompanionAdults("bawa anak"), undefined);

// Terhubung ke extractor utama: slot terisi tanpa perlu tamu menyebut angka.
const companionSlots = extractAllSlots("Ato bawa pacar", [], undefined, "2026-08-10");
assert.equal(companionSlots.adults, 2, "'bawa pacar' harus mengisi adults=2");
assert.equal(companionSlots.children, 0);

// Angka eksplisit tetap menang atas tebakan pendamping.
assert.equal(
  extractAllSlots("bawa pacar sama 3 temen, total 5 orang", [], undefined, "2026-08-10").adults,
  5,
);

// Aturan prompt Front Office yang mengunci perilaku di atas.
const guestPrompt = frontOfficeAgent.buildSystemPrompt({
  property: { name: "Pomah Guesthouse" },
  rooms: [],
  sopText: "",
  today: "2026-08-10",
} as unknown as AgentContext);

assert.ok(
  /ANTI-REPETISI PERTANYAAN SLOT/.test(guestPrompt),
  "prompt wajib melarang pertanyaan slot yang sama ditanya dua kali",
);
assert.ok(
  /PENDAMPING TANPA ANGKA/.test(guestPrompt),
  "prompt wajib memperlakukan 'bawa pacar' sebagai jawaban jumlah tamu",
);
assert.ok(
  /PERTANYAAN LONGGAR/.test(guestPrompt),
  "prompt wajib menjawab 'bebas ngga?' langsung, bukan balik bertanya",
);

console.log("✓ chatbot consistency regressions passed");
