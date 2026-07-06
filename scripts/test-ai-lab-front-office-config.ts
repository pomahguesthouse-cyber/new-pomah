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
truthy("runtime prompt preserves live date context", prompt.includes("Hari ini tanggal"));
truthy("runtime prompt preserves room context", prompt.includes("Deluxe"));
truthy("runtime prompt preserves SOP context", prompt.includes("Check-in mulai pukul 14.00."));
truthy("runtime prompt includes tool-result guard", prompt.includes("hasil tool sebagai sumber kebenaran"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
