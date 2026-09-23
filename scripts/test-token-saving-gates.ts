/**
 * Gerbang penghemat token — prioritas 1–4.
 *
 *   1. Orchestrator tidak embed training lagi setelah percobaan (kosong/gagal).
 *   2. LLM intent tidak jalan untuk sapaan, thanks, emoji, media kosong,
 *      pesan pendek, atau klasifikasi deterministik yang sudah kuat.
 *   3. SOP retrieval tidak jalan untuk sapaan / thanks / emoji / media kosong.
 *   4. Intent general memakai prompt Front Office ringan; booking, availability,
 *      dan payment tetap membawa blok tool.
 */
import assert from "node:assert/strict";
import { classifyIntent } from "../src/ai/router/intent-classifier";
import { routeToAgent } from "../src/ai/router/agent-router";
import {
  isClearGreeting,
  isClearThanks,
  isEmojiOnly,
  isMediaOnlyWithoutText,
  shouldSkipOrchestratorTrainingRetrieval,
  shouldSkipSopRetrieval,
} from "../src/ai/router/message-gates";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext } from "../src/ai/agents/types";

const llmConfig = { apiKey: "test-key", baseUrl: "https://llm.invalid/v1", model: "test" };

let llmCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const url = String(args[0] ?? "");
  if (url.includes("/chat/completions")) llmCalls += 1;
  return new Response("{}", { status: 500 });
}) as typeof fetch;

async function intentOf(text: string) {
  const before = llmCalls;
  const result = await classifyIntent(text, undefined, llmConfig);
  return { result, llmCalls: llmCalls - before };
}

// ─── 1. Anti double-embed ────────────────────────────────────────────────────

assert.equal(
  shouldSkipOrchestratorTrainingRetrieval({
    trainingRetrievalAttempted: true,
    trainingExampleCount: 0,
    lastUserMessage: "harga kamar malam ini",
  }),
  true,
  "hasil kosong tetap dihitung sebagai percobaan — jangan embed ulang",
);
assert.equal(
  shouldSkipOrchestratorTrainingRetrieval({
    trainingRetrievalAttempted: true,
    trainingExampleCount: 2,
    lastUserMessage: "saya mau booking 2 orang",
  }),
  true,
);
assert.equal(
  shouldSkipOrchestratorTrainingRetrieval({
    trainingRetrievalAttempted: false,
    trainingExampleCount: 0,
    lastUserMessage: "harga kamar malam ini",
  }),
  false,
  "belum ada percobaan → orchestrator masih boleh embed sekali",
);
assert.equal(
  shouldSkipOrchestratorTrainingRetrieval({
    trainingExampleCount: 1,
    lastUserMessage: "harga kamar malam ini",
  }),
  true,
  "contoh yang sudah disuntik tidak perlu di-embed ulang",
);
for (const social of ["halo", "makasih ya kak", "🙏", "[Lampiran image]"]) {
  assert.equal(
    shouldSkipOrchestratorTrainingRetrieval({
      trainingRetrievalAttempted: false,
      trainingExampleCount: 0,
      lastUserMessage: social,
    }),
    true,
    `pesan sosial tidak boleh memicu embedding training: ${social}`,
  );
}

// ─── 3. Gerbang SOP (dicek sebelum contoh intent, karena murni) ──────────────

for (const skip of ["halo", "halo kak", "selamat pagi", "makasih", "makasih ya kak", "terima kasih", "🙏", "👍❤️", "[Lampiran image]", "[Lampiran imageMessage]"]) {
  assert.equal(shouldSkipSopRetrieval(skip), true, `SOP harus dilewati: ${skip}`);
}
for (const keep of [
  "harga kamar malam ini",
  "saya mau booking 2 orang",
  "halo, ada kamar ga?",
  "[Lampiran image] ini bukti transfer",
  "[Tamu mengirim lampiran bukti transfer pembayaran]",
]) {
  assert.equal(shouldSkipSopRetrieval(keep), false, `SOP harus tetap jalan: ${keep}`);
}
assert.equal(isClearGreeting("halo, ada kamar ga?"), false);
assert.equal(isClearThanks("makasih, mau booking"), false);
assert.equal(isEmojiOnly("halo 👍"), false);
assert.equal(isMediaOnlyWithoutText("[Tamu mengirim lampiran bukti transfer pembayaran]"), false);

// ─── 2. Intent: tanpa LLM untuk kasus jelas, routing booking/harga utuh ─────

const halo = await intentOf("halo");
assert.equal(halo.result.category, "greeting");
assert.equal(halo.llmCalls, 0, "sapaan tidak boleh memanggil LLM intent");

const thanks = await intentOf("makasih");
assert.equal(thanks.result.category, "greeting");
assert.ok(thanks.result.matchedTerms.includes("thanks") || thanks.result.matchedTerms.some((t) => /makasih/i.test(t)));
assert.equal(thanks.llmCalls, 0, "terima kasih tidak boleh memanggil LLM intent");

const emoji = await intentOf("🙏");
assert.equal(emoji.result.category, "greeting");
assert.equal(emoji.llmCalls, 0, "emoji-only tidak boleh memanggil LLM intent");

const photo = await intentOf("[Lampiran image]");
assert.equal(photo.llmCalls, 0, "foto tanpa caption tidak boleh memanggil LLM intent");
assert.notEqual(photo.result.category, "booking_inquiry");
assert.notEqual(photo.result.category, "booking_start");

const price = await intentOf("harga kamar malam ini");
assert.equal(price.result.category, "pricing_inquiry");
assert.equal(price.llmCalls, 0, "tanya harga yang sudah jelas tidak boleh jatuh ke LLM");
assert.equal(routeToAgent(price.result).agentKey, "pricing");

const booking = await intentOf("saya mau booking 2 orang");
assert.ok(
  booking.result.category === "booking_start" || booking.result.category === "booking_inquiry",
  `booking harus tetap booking, dapat ${booking.result.category}`,
);
assert.equal(booking.llmCalls, 0, "perintah booking yang sudah jelas tidak boleh jatuh ke LLM");
assert.equal(routeToAgent(booking.result).agentKey, "front-office");

const nego = await intentOf("boleh nego?");
assert.equal(nego.result.category, "pricing_inquiry");
assert.equal(nego.llmCalls, 0, "negosiasi yang sudah jelas tidak boleh memanggil LLM");
assert.equal(routeToAgent(nego.result).agentKey, "pricing");

const negoWithAvailability = await intentOf("ada kamar, boleh nego?");
assert.equal(negoWithAvailability.result.category, "availability_check");
assert.equal(negoWithAvailability.llmCalls, 0);

const avail = await intentOf("ada kamar malam ini?");
assert.equal(avail.result.category, "availability_check");
assert.equal(avail.llmCalls, 0);
assert.equal(routeToAgent(avail.result).agentKey, "front-office");

const paymentProof = await intentOf("[Tamu mengirim lampiran bukti transfer pembayaran]");
assert.equal(paymentProof.result.category, "payment");
assert.equal(paymentProof.llmCalls, 0);
assert.equal(routeToAgent(paymentProof.result).agentKey, "finance");

const shortGeneral = await intentOf("cuaca");
assert.equal(shortGeneral.result.category, "general");
assert.equal(shortGeneral.llmCalls, 0, "pesan pendek yang memang general tidak boleh memanggil LLM");

// Balapan dua aturan berbobot sama — satu-satunya alasan LLM intent.
const beforeRace = llmCalls;
await classifyIntent("menginap dan ada parkir ya kakak", undefined, llmConfig);
assert.equal(llmCalls, beforeRace + 1, "dua aturan yang imbang boleh memakai LLM intent");

// Pertanyaan panjang tanpa aturan: general ambigu, LLM boleh.
const longQ =
  "apakah boleh jika saya tiba lebih dulu lalu menitipkan koper di lobi sebelum jam yang ditentukan oleh resepsionis?";
const beforeLong = llmCalls;
const longResult = await classifyIntent(longQ, undefined, llmConfig);
assert.equal(longResult.category, "general");
assert.equal(llmCalls, beforeLong + 1, "pertanyaan panjang yang tidak kena aturan boleh memakai LLM");

// ─── 4. Prompt ringan vs penuh ───────────────────────────────────────────────

const ctx = (over: Partial<AgentContext> = {}): AgentContext =>
  ({
    property: { name: "Pomah Guesthouse" },
    rooms: [{ name: "Deluxe", base_rate: 300000, capacity: 2 }],
    sopText: "",
    today: "2026-08-26",
    ...over,
  }) as unknown as AgentContext;

const full = frontOfficeAgent.buildSystemPrompt(ctx());
const general = frontOfficeAgent.buildSystemPrompt(ctx({ intent: "general" }));
const priced = frontOfficeAgent.buildSystemPrompt(ctx({ intent: "pricing_inquiry" }));
const bookingPrompt = frontOfficeAgent.buildSystemPrompt(ctx({ intent: "booking_inquiry" }));
const withDates = frontOfficeAgent.buildSystemPrompt(ctx({
  intent: "general",
  agreedDates: { checkIn: "2026-09-01", checkOut: "2026-09-02" },
}));

assert.ok(general.includes("Anda adalah Rani"));
assert.ok(general.includes("EARLY CHECK-IN / LATE CHECK-OUT"));
assert.ok(!general.includes("KETERSEDIAAN KAMAR — ATURAN TANGGAL"));
assert.ok(!general.includes("BOOKING VIA CHAT"));
assert.ok(general.length < full.length * 0.5);
assert.ok(priced.includes("KETERSEDIAAN KAMAR — ATURAN TANGGAL"), "pricing di FO tetap blok availability");
assert.ok(bookingPrompt.includes("BOOKING VIA CHAT"));
assert.ok(withDates.includes("BOOKING VIA CHAT"), "general + tanggal tersimpan kembali ke prompt booking");

const custom = frontOfficeAgent.buildDynamicPrompt!(ctx({
  intent: "general",
  customInstructions: "Selalu sebut promo Agustus.",
}));
assert.ok(custom.includes("promo Agustus"));
assert.ok(custom.includes("INSTRUKSI TAMBAHAN DARI AI LAB"));

globalThis.fetch = originalFetch;

console.log("✓ token-saving gates passed");
