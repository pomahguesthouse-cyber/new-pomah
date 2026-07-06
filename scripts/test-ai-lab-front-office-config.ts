/**
 * Regression test for AI Lab Front Office instructions.
 *
 * Run: npx tsx scripts/test-ai-lab-front-office-config.ts
 */

import {
  AGENT_DEFAULTS,
  FRONT_OFFICE_DEFAULT_INSTRUCTIONS,
  mergeAiLabConfig,
} from "../src/admin/modules/ai-lab/ai-lab.functions";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import {
  cleanReplyBody,
  normalizeBrochureReply,
  pickAttachment,
} from "../src/services/reply-postprocess";
import type { AgentContext } from "../src/ai/agents/types";

let passed = 0;
let failed = 0;

function truthy(label: string, value: unknown): void {
  if (value) {
    passed += 1;
    console.log(`PASS ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label} (got: ${JSON.stringify(value)})`);
}

const merged = mergeAiLabConfig({});
truthy(
  "front office default is the configured Pomah prompt",
  AGENT_DEFAULTS["front-office"] === FRONT_OFFICE_DEFAULT_INSTRUCTIONS &&
    merged.agents["front-office"].instructions.includes("Kamu adalah Front Office Agent Pomah Guesthouse"),
);

const legacyMerged = mergeAiLabConfig({
  agents: {
    "front-office": {
      instructions: "Anda adalah Rani yang bertugas sebagai Front Office Agent untuk {{PROPERTY_NAME}}.",
    },
  },
});
truthy(
  "legacy front office default is upgraded",
  legacyMerged.agents["front-office"].instructions === FRONT_OFFICE_DEFAULT_INSTRUCTIONS,
);

const prompt = frontOfficeAgent.buildSystemPrompt({
  property: { id: "prop-test", name: "Pomah Guesthouse" },
  rooms: [{ id: "rt-deluxe", name: "Deluxe", base_rate: 250000, capacity: 2 }],
  sopText: "Check-in mulai pukul 14.00.",
  today: "2026-07-06",
  customInstructions: merged.agents["front-office"].instructions,
} as AgentContext);

truthy("runtime prompt includes custom instruction", prompt.includes("Kamu adalah Front Office Agent Pomah Guesthouse"));
truthy(
  "runtime prompt appends custom instruction below hard guard",
  prompt.includes("INSTRUKSI TAMBAHAN DARI AI LAB") &&
    prompt.indexOf("BOOKING VIA CHAT:") < prompt.indexOf("INSTRUKSI TAMBAHAN DARI AI LAB"),
);
truthy("runtime prompt preserves live date context", prompt.includes("Hari ini tanggal"));
truthy("runtime prompt preserves room context", prompt.includes("Deluxe"));
truthy("runtime prompt preserves SOP context", prompt.includes("Check-in mulai pukul 14.00."));
truthy("runtime prompt preserves hard availability guard", prompt.includes("check_room_availability") && prompt.includes("jangan menebak"));

const brochureFiles = [
  {
    name: "brosur kamar pomah guesthouse.pdf",
    url: "https://example.com/brosur-kamar-pomah-guesthouse.pdf",
  },
];
const badBrochureReply =
  "Pomah Guesthouse tidak menyediakan brosur fisik maupun digital. Untuk informasi lengkap silakan kunjungi situs web resmi kami.";
const pickedBrochure = pickAttachment("minta brosur dong", badBrochureReply, brochureFiles);
const normalizedBrochureReply = normalizeBrochureReply(
  "minta brosur dong",
  badBrochureReply,
  pickedBrochure.name,
);
const finalBrochureReply = cleanReplyBody(normalizedBrochureReply, pickedBrochure.url);

truthy("brochure request selects uploaded PDF", pickedBrochure.name === brochureFiles[0].name);
truthy(
  "brochure denial is replaced when PDF is attached",
  /berikut saya kirimkan brosur/i.test(finalBrochureReply) &&
    !/tidak menyediakan brosur/i.test(finalBrochureReply),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
