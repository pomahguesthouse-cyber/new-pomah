import fs from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = fs.readFileSync(path, "utf8");

const oldSummaryTypesImport = `import {
  type ChatSummaryStructured,
  LAST_TOPIC_VALUES,
  BOOKING_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
} from "@/ai/chat-summary.types";`;
const newSummaryTypesImport = `import { type ChatSummaryStructured } from "@/ai/chat-summary.types";`;
if (!source.includes(oldSummaryTypesImport)) {
  throw new Error("Unable to find chat summary types import");
}
source = source.replace(oldSummaryTypesImport, newSummaryTypesImport);

const identityImportEnd = `} from "@/services/wa-autoreply/identity";`;
const policyImport = `
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_REGEN_COOLDOWN_MS,
  parseStructuredSummary,
  shouldForceSummary,
} from "@/services/wa-autoreply/session-summary-policy";`;
if (!source.includes(identityImportEnd)) {
  throw new Error("Unable to find identity import anchor");
}
source = source.replace(identityImportEnd, `${identityImportEnd}${policyImport}`);

const tuningStart = source.indexOf("// ── Summarizer tuning knobs");
const heavyRetrievalStart = source.indexOf("function shouldLoadHeavyRetrieval", tuningStart);
if (tuningStart < 0 || heavyRetrievalStart < 0) {
  throw new Error("Unable to isolate summary tuning policy block");
}
source = source.slice(0, tuningStart) + source.slice(heavyRetrievalStart);

const maxCharsStart = source.indexOf("/** Hard cap on persisted `short_summary` length (chars). Prevents prompt bloat. */");
const minMessagesStart = source.indexOf("/** Below this many messages, summarizing is pointless — skip. */", maxCharsStart);
if (maxCharsStart < 0 || minMessagesStart < 0) {
  throw new Error("Unable to isolate summary max chars constant");
}
source = source.slice(0, maxCharsStart) + source.slice(minMessagesStart);

const parserStart = source.indexOf("function parseStructuredSummary(raw: string): ChatSummaryStructured | null {");
const updateDocStart = source.indexOf("/**\n * Persist a structured summary ke whatsapp_threads.", parserStart);
if (parserStart < 0 || updateDocStart < 0) {
  throw new Error("Unable to isolate structured summary parser");
}
source = source.slice(0, parserStart) + source.slice(updateDocStart);

fs.writeFileSync(path, source);
console.log("Applied guarded WhatsApp session summary policy extraction.");
