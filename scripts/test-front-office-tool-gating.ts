/**
 * Regresi gating Front Office — audit anggaran token 26 Agu 2026.
 *
 * Dua pemangkasan dikunci di sini, keduanya digerakkan oleh `ctx.intent`:
 *
 *   1. TOOL  — skema 9 tool guest (2.735 token) dikirim ULANG tiap turn loop.
 *   2. PROMPT — system prompt guest 27,5 rb karakter (±7,8 rb token), idem.
 *
 * Tes ini mengunci KEDUA sisi: penghematan DAN kapabilitas yang tidak boleh
 * hilang — terutama invarian #1 (media) dan #5 (anti-repetisi slot) di
 * chatbot-consistency, plus satu invarian baru: prompt tidak boleh menyuruh
 * memanggil tool yang tidak ikut dikirim.
 */
import assert from "node:assert/strict";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext, IntentCategory } from "../src/ai/agents/types";

const ctx = (over: Partial<AgentContext> = {}): AgentContext =>
  ({
    property: { name: "Pomah Guesthouse" },
    rooms: [{ name: "Deluxe", base_rate: 300000, capacity: 2 }],
    sopText: "",
    today: "2026-08-26",
    ...over,
  }) as unknown as AgentContext;

const names = (over: Partial<AgentContext> = {}): string[] =>
  (frontOfficeAgent.getTools?.(ctx(over)) ?? frontOfficeAgent.tools).map((t) => t.function.name);

const prompt = (over: Partial<AgentContext> = {}): string =>
  frontOfficeAgent.buildSystemPrompt(ctx(over));

const CORE = ["check_room_availability", "get_room_specifications", "update_booking_slots"];
const MEDIA = ["send_room_photos", "send_room_tour"];
const AVAIL = ["offer_alternative_rooms"];
const BOOKING = ["start_booking_details", "generate_booking_form", "get_booking_form_submission"];

const has = (list: string[], want: string[]) => want.every((n) => list.includes(n));
const hasNone = (list: string[], want: string[]) => want.every((n) => !list.includes(n));

// ═══ BAGIAN A — gating tool ══════════════════════════════════════════════════

// ─── A1. Tanpa sinyal intent → set PENUH (simulator / entry point lama) ─────

const full = names();
assert.ok(has(full, CORE) && has(full, MEDIA) && has(full, AVAIL) && has(full, BOOKING),
  "ctx.intent undefined wajib memakai set tool penuh — pemanggil lama tidak boleh kehilangan kapabilitas");
assert.ok(!full.includes("create_booking"), "create_booking tidak boleh bocor ke mode guest");

// ─── A2. Intent netral → hanya tool inti ────────────────────────────────────

for (const intent of ["greeting", "checkin_policy_question", "complaint"] as const) {
  const list = names({ intent });
  assert.ok(has(list, CORE), `${intent} tetap butuh tool inti`);
  assert.ok(hasNone(list, [...MEDIA, ...AVAIL, ...BOOKING]), `${intent} tidak butuh tool lain`);
  assert.equal(list.length, CORE.length);
}

// ─── A3. Invarian #1 — media_request SELALU membawa tool media ─────────────

assert.ok(has(names({ intent: "media_request" }), MEDIA),
  "send_room_photos / send_room_tour WAJIB ada saat intent media_request (invarian #1)");

// ─── A4. Alur kamar → tool availability; alur booking → tool booking ───────

const avail = names({ intent: "availability_check" });
assert.ok(has(avail, AVAIL), "cek ketersediaan butuh offer_alternative_rooms");
assert.ok(hasNone(avail, BOOKING), "cek ketersediaan polos belum butuh tool pembuatan booking");

assert.ok(has(names({ intent: "booking_inquiry" }), [...AVAIL, ...BOOKING]),
  "intent booking wajib punya jalur booking lengkap");

// ─── A5. Escape hatch: intent netral TAPI konteks booking sudah ada ────────
// "oke" / "siap" setelah tanggal + tipe kamar disepakati sering jatuh ke intent
// `general`. Tanpa escape hatch, start_booking_details hilang persis saat tamu
// menyatakan setuju.

const withDates = { agreedDates: { checkIn: "2026-09-01", checkOut: "2026-09-02" } };
assert.ok(has(names({ intent: "general", ...withDates }), BOOKING),
  "tanggal yang sudah disepakati wajib membuka jalur booking");
assert.ok(has(names({ intent: "general", partialBooking: { roomType: "Deluxe" } }), BOOKING),
  "tipe kamar parsial wajib membuka jalur booking");
assert.ok(has(names({ intent: "greeting", chatSummaryJson: { room_type: "Deluxe" } as never }), BOOKING),
  "room_type di ringkasan sesi wajib membuka jalur booking");
assert.ok(hasNone(names({ intent: "general", chatSummaryJson: { booking_status: "none" } as never }), BOOKING),
  "booking_status 'none' bukan konteks booking");

// ─── A6. bookingInProgress → tool pemicu booking DIHAPUS ──────────────────

const midBooking = { intent: "booking_inquiry" as const, bookingInProgress: true };
assert.ok(hasNone(names(midBooking), BOOKING),
  "state machine sedang memegang kendali — LLM tidak boleh memicu ulang flow booking");
assert.ok(has(names(midBooking), CORE), "interupsi di tengah booking tetap boleh cek kamar / spesifikasi");

// ─── A7. Mode managerial tidak tersentuh ──────────────────────────────────

const managerial = names({ mode: "managerial", intent: "greeting" });
assert.ok(has(managerial, ["create_booking", "get_bookings", "delete_booking"]),
  "mode managerial wajib tetap memakai FRONT_OFFICE_MANAGER_TOOLS");
assert.ok(hasNone(managerial, ["start_booking_details"]), "manager tidak memakai flow step-by-step tamu");

// ═══ BAGIAN B — gating blok prompt ═══════════════════════════════════════════

const CORE_MARKERS = [
  "Anda adalah Rani",
  "TONE: Ramah",
  "JANGAN PERNAH gunakan sapaan waktu",
  "ANTI-PENGULANGAN SAPAAN",
  "FORMAT TANGGAL",
  "PENUTUP PERCAKAPAN",
  "FORMAT PESAN: WhatsApp",
  "CARA / METODE BOOKING (FAQ)",
  "TAMU MENGIRIM GAMBAR",
];
const FAQ_MARKERS = [
  "EARLY CHECK-IN / LATE CHECK-OUT",
  "INFO PENTING TAMBAHAN",
  "ULASAN GOOGLE",
  "PERTANYAAN JARAK / LOKASI",
];
const ROOM_FACT_MARKERS = [
  "KEBIJAKAN USIA TAMU",
  "KONSISTENSI LABEL KAPASITAS",
  "EXTRA BED:",
  "PERTANYAAN TIPE FAMILY",
];
const AVAIL_MARKERS = [
  "KETERSEDIAAN KAMAR — ATURAN TANGGAL",
  "HARD GUARD HASIL AVAILABILITY",
  "KAMAR DIMINTA PENUH",
  "JANGAN TANYA TANGGAL YANG SUDAH DIKETAHUI",
];
const SLOT_INVARIANT_MARKERS = [
  "ANTI-REPETISI PERTANYAAN SLOT",
  "PENDAMPING TANPA ANGKA",
  "PERTANYAAN LONGGAR",
];
const BOOKING_MARKERS = ["BOOKING VIA CHAT", "TUTUP BOOKING SAAT TAMU SUDAH SETUJU", "SLOT-FILL PARTIAL"];
const MEDIA_MARKERS = ["FOTO / GAMBAR / VIDEO / BROSUR KAMAR", "VIRTUAL TOUR 360°"];

const contains = (p: string, markers: string[]) => markers.every((m) => p.includes(m));
const containsNone = (p: string, markers: string[]) => markers.every((m) => !p.includes(m));

// ─── B1. Tanpa intent → prompt PENUH (mengunci kompatibilitas mundur) ─────

const fullPrompt = prompt();
for (const group of [CORE_MARKERS, FAQ_MARKERS, ROOM_FACT_MARKERS, AVAIL_MARKERS,
  SLOT_INVARIANT_MARKERS, BOOKING_MARKERS, MEDIA_MARKERS]) {
  assert.ok(contains(fullPrompt, group), "prompt tanpa intent wajib memuat SEMUA blok");
}

// ─── B2. Blok inti tidak pernah hilang, apa pun intentnya ─────────────────

const ALL_GUEST_INTENTS: IntentCategory[] = [
  "greeting", "booking_inquiry", "availability_check", "pricing_inquiry", "customer-care",
  "maintenance", "payment", "complaint", "booking_start", "guest_count_input",
  "payment_policy_question", "bank_account_request", "invoice_request", "room_detail_question",
  "media_request", "checkin_policy_question", "early_arrival_guest_question", "general",
];
for (const intent of ALL_GUEST_INTENTS) {
  assert.ok(contains(prompt({ intent }), CORE_MARKERS), `blok inti hilang untuk intent ${intent}`);
}

// ─── B3. Sapaan → prompt ramping, tapi FAQ tetap ada ─────────────────────

const greetingPrompt = prompt({ intent: "greeting" });
assert.ok(contains(greetingPrompt, FAQ_MARKERS), "sapaan tetap butuh FAQ (tamu sering lanjut tanya)");
assert.ok(containsNone(greetingPrompt, [...AVAIL_MARKERS, ...BOOKING_MARKERS, ...MEDIA_MARKERS]),
  "sapaan tidak butuh aturan tanggal / booking / media");
assert.ok(greetingPrompt.length < fullPrompt.length * 0.45,
  `prompt sapaan harus <45% prompt penuh, dapatnya ${Math.round((greetingPrompt.length / fullPrompt.length) * 100)}%`);

// ─── B4. Invarian #1 — blok media menyala bersama tool-nya ───────────────

const mediaPrompt = prompt({ intent: "media_request" });
assert.ok(contains(mediaPrompt, MEDIA_MARKERS),
  "aturan foto & virtual tour WAJIB ada saat intent media_request (invarian #1)");

// ─── B5. Invarian #5 — anti-repetisi slot menyala di seluruh alur kamar ──

for (const intent of ["availability_check", "booking_inquiry", "guest_count_input", "booking_start"] as const) {
  assert.ok(contains(prompt({ intent }), SLOT_INVARIANT_MARKERS),
    `blok anti-repetisi slot (invarian #5) hilang untuk intent ${intent}`);
}
assert.ok(contains(prompt({ intent: "general", ...withDates }), SLOT_INVARIANT_MARKERS),
  "percakapan dengan tanggal tersimpan tetap butuh invarian #5");

// ─── B6. Alur kamar → FAQ dimatikan, aturan tanggal menyala ──────────────

const availPrompt = prompt({ intent: "availability_check" });
assert.ok(contains(availPrompt, [...AVAIL_MARKERS, ...ROOM_FACT_MARKERS]));
assert.ok(containsNone(availPrompt, FAQ_MARKERS), "tengah negosiasi tanggal tidak butuh FAQ sarapan/OTA");
assert.ok(containsNone(availPrompt, BOOKING_MARKERS),
  "cek ketersediaan polos belum butuh aturan penutupan booking");
assert.ok(contains(prompt({ intent: "availability_check", ...withDates }), BOOKING_MARKERS),
  "begitu tanggal tersimpan, aturan booking wajib menyala");

// ─── B7. bookingInProgress → aturan pemicu booking ikut dimatikan ────────

const midPrompt = prompt(midBooking);
assert.ok(containsNone(midPrompt, BOOKING_MARKERS),
  "state machine memegang kendali — aturan pemicu booking tidak boleh ikut terkirim");
assert.ok(midPrompt.includes("TAMU SEDANG MENGISI DATA BOOKING"),
  "blok interupsi mid-booking wajib tetap ada");

// ═══ BAGIAN C — invarian baru: prompt tidak menyuruh tool yang tidak dikirim ═

/** Kalimat imperatif → tool yang WAJIB ikut dikirim bila kalimat itu muncul. */
const IMPERATIVE_TO_TOOL: Array<[string, string]> = [
  ["WAJIB panggil `check_room_availability`", "check_room_availability"],
  ["WAJIB panggil `get_room_specifications`", "get_room_specifications"],
  ["WAJIB panggil `update_booking_slots`", "update_booking_slots"],
  ["WAJIB panggil `offer_alternative_rooms`", "offer_alternative_rooms"],
  ["LANGSUNG panggil `start_booking_details`", "start_booking_details"],
  ["`generate_booking_form` SEBAGAI PENGGANTI", "generate_booking_form"],
  ["panggil `send_room_photos` di turn yang sama", "send_room_photos"],
  ["panggil `send_room_tour` di turn yang sama", "send_room_tour"],
];

const VARIANTS: Array<[string, Partial<AgentContext>]> = [
  ["polos", {}],
  ["tanggal tersimpan", withDates],
  ["mid-booking", { bookingInProgress: true }],
  ["kamar parsial", { partialBooking: { roomType: "Deluxe" } }],
];

for (const intent of ALL_GUEST_INTENTS) {
  for (const [label, over] of VARIANTS) {
    const over2 = { intent, ...over };
    const p = prompt(over2);
    const t = names(over2);
    for (const [phrase, tool] of IMPERATIVE_TO_TOOL) {
      if (p.includes(phrase)) {
        assert.ok(t.includes(tool),
          `prompt menyuruh "${phrase}" tapi tool ${tool} tidak dikirim (intent ${intent}, ${label})`);
      }
    }
  }
}

// ═══ Ringkasan penghematan ═══════════════════════════════════════════════════

const toolChars = (over: Partial<AgentContext>) =>
  JSON.stringify(frontOfficeAgent.getTools?.(ctx(over)) ?? []).length;
const pct = (a: number, b: number) => Math.round((1 - a / b) * 100);
const baseTools = JSON.stringify(frontOfficeAgent.tools).length;

// ═══ BAGIAN D — pemisahan system message statis vs dinamis (lever #3) ════════

const staticOf = (over: Partial<AgentContext> = {}) => frontOfficeAgent.buildStaticPrompt!(ctx(over));
const dynamicOf = (over: Partial<AgentContext> = {}) => frontOfficeAgent.buildDynamicPrompt!(ctx(over));

// ─── D1. Tidak ada yang hilang: statis + dinamis === prompt utuh ─────────────

const SPLIT_VARIANTS: Array<Partial<AgentContext>> = [
  {},
  { intent: "greeting" },
  { intent: "availability_check" },
  { intent: "booking_inquiry", ...withDates },
  { intent: "media_request", sopText: "SOP: check-in 14.00." },
  { intent: "general", bookingInProgress: true },
  { intent: "booking_inquiry", partialBooking: { roomType: "Deluxe", adults: 2 } },
  { intent: "general", customInstructions: "Selalu sebut promo Agustus." },
  { intent: "availability_check", ambiguousRoomReference: { candidate: "Deluxe", offeredRooms: ["Single", "Deluxe"] } },
  { mode: "managerial", intent: "list_bookings" },
];
for (const over of SPLIT_VARIANTS) {
  const joined = [staticOf(over), dynamicOf(over)].filter(Boolean).join("\n\n");
  assert.equal(joined, frontOfficeAgent.buildSystemPrompt(ctx(over)),
    `statis + dinamis harus persis sama dengan buildSystemPrompt (${JSON.stringify(over)})`);
}

// ─── D2. Prefix statis stabil terhadap perubahan per-giliran ────────────────
// Kalau field di bawah bisa menggeser prompt statis, prefix cache batal tiap
// pesan dan lever #3 tidak ada gunanya. Field yang MEMANG menggeser gate
// (agreedDates, partialBooking, chatSummaryJson) sengaja tidak diuji di sini —
// bucket cache-nya beda dan itu benar.

const PER_TURN_ONLY: Array<[string, Partial<AgentContext>]> = [
  ["sopText (hasil RAG)", { sopText: "SOP: kebijakan pembatalan H-3." }],
  ["customInstructions", { customInstructions: "Selalu sebut promo Agustus." }],
  ["chatSummary teks", { chatSummary: "Tamu tanya Deluxe untuk akhir pekan." }],
  ["lastMessage", { lastMessage: "ada kamar besok?" }],
  ["recoveryMode", { recoveryMode: true, unansweredMessages: ["halo", "kak?"] }],
  ["activeBookingContext", { activeBookingContext: "BOOKING AKTIF: PMH-123" }],
  ["guestProfile", { guestProfile: { full_name: "Budi", total_bookings: 3 } as never }],
  ["trainingExamples", {
    trainingExamples: [{ id: "1", intent: null, stage: null, user_message: "harga?", ideal_assistant_response: "Rp300rb" }],
  }],
];
for (const intent of ["greeting", "availability_check", "booking_inquiry"] as const) {
  const baseline = staticOf({ intent });
  for (const [label, over] of PER_TURN_ONLY) {
    assert.equal(staticOf({ intent, ...over }), baseline,
      `prompt statis bergeser karena ${label} (intent ${intent}) — prefix cache batal tiap pesan`);
  }
}

// ─── D3. Isi per-giliran benar-benar pindah ke bagian dinamis ───────────────

const dyn = dynamicOf({
  intent: "booking_inquiry",
  ...withDates,
  sopText: "SOP: kebijakan pembatalan H-3.",
  partialBooking: { roomType: "Deluxe" },
  customInstructions: "Selalu sebut promo Agustus.",
});
for (const marker of [
  "TANGGAL SUDAH DISEPAKATI",
  "INFO YANG SUDAH DISIMPAN",
  "Basis Pengetahuan SOP",
  "kebijakan pembatalan H-3",
  "INSTRUKSI TAMBAHAN DARI AI LAB",
  "promo Agustus",
]) {
  assert.ok(dyn.includes(marker), `"${marker}" wajib ada di bagian dinamis`);
}

const stat = staticOf({
  intent: "booking_inquiry",
  ...withDates,
  sopText: "SOP: kebijakan pembatalan H-3.",
  partialBooking: { roomType: "Deluxe" },
  customInstructions: "Selalu sebut promo Agustus.",
});
for (const marker of [
  "TANGGAL SUDAH DISEPAKATI",
  "Basis Pengetahuan SOP",
  "kebijakan pembatalan H-3",
  "INSTRUKSI TAMBAHAN DARI AI LAB",
  "promo Agustus",
  "TAMU SEDANG MENGISI DATA BOOKING",
]) {
  assert.ok(!stat.includes(marker), `"${marker}" bocor ke prompt statis — prefix cache batal`);
}
assert.ok(contains(stat, CORE_MARKERS), "persona & aturan utama wajib tetap di bagian statis");

// ─── D4. Mode managerial: seluruh prompt statis, tidak ada bagian dinamis ───

assert.equal(dynamicOf({ mode: "managerial", intent: "list_bookings" }), "");
assert.ok(staticOf({ mode: "managerial", intent: "list_bookings" }).includes("Manajer Front Office"));

console.log(
  `✓ front office gating passed — ` +
    `prompt ${fullPrompt.length}→${greetingPrompt.length} char (-${pct(greetingPrompt.length, fullPrompt.length)}% sapaan, ` +
    `-${pct(availPrompt.length, fullPrompt.length)}% availability), ` +
    `tool ${baseTools}→${toolChars({ intent: "greeting" })} char (-${pct(toolChars({ intent: "greeting" }), baseTools)}%)`,
);
