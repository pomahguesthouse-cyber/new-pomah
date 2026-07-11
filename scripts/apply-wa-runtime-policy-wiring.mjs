import fs from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = fs.readFileSync(path, "utf8");

const importAnchor = 'import { buildPropertyFaqReply } from "@/services/property-faq";';
const runtimePolicyImport = `import {
  AI_TIMEOUT_LIGHT_MS,
  AI_TIMEOUT_MS,
  FALLBACK_MESSAGE,
  MANAGER_FALLBACK_MESSAGE,
  QUICK_ACK_MESSAGE,
  buildStateAwareFallback,
  pickAiBudgetMs,
} from "@/services/wa-autoreply/runtime-policy";`;

if (!source.includes(importAnchor)) {
  throw new Error("Unable to find runtime policy import anchor");
}
if (!source.includes(runtimePolicyImport)) {
  source = source.replace(importAnchor, `${importAnchor}\n${runtimePolicyImport}`);
}

const fallbackStart = 'const FALLBACK_MESSAGE = "Maaf Kak, sistem sedang lambat.';
const fallbackEnd = "const QUICK_ACK_AFTER_MS = 6_000;";
const fallbackStartIndex = source.indexOf(fallbackStart);
const fallbackEndIndex = source.indexOf(fallbackEnd, fallbackStartIndex);
if (fallbackStartIndex < 0 || fallbackEndIndex < 0) {
  throw new Error("Unable to find duplicated fallback policy block");
}
source = source.slice(0, fallbackStartIndex) + source.slice(fallbackEndIndex);

const timeoutStart = "/**\n * Anggaran waktu untuk SATU attempt orchestrasi penuh";
const timeoutEnd = "// Deadline dinding-jam untuk satu iterasi handleOne";
const timeoutStartIndex = source.indexOf(timeoutStart);
const timeoutEndIndex = source.indexOf(timeoutEnd, timeoutStartIndex);
if (timeoutStartIndex < 0 || timeoutEndIndex < 0) {
  throw new Error("Unable to find duplicated timeout policy block");
}
source = source.slice(0, timeoutStartIndex) + source.slice(timeoutEndIndex);

for (const forbidden of [
  "const FALLBACK_MESSAGE =",
  "const MANAGER_FALLBACK_MESSAGE =",
  "const QUICK_ACK_MESSAGE =",
  "function buildStateAwareFallback(",
  "const AI_TIMEOUT_MS =",
  "const AI_TIMEOUT_LIGHT_MS =",
  "const HEAVY_INTENT_RE =",
  "function pickAiBudgetMs(",
]) {
  if (source.includes(forbidden)) {
    throw new Error(`Runtime policy duplicate remains: ${forbidden}`);
  }
}

fs.writeFileSync(path, source);
console.log("Applied guarded WhatsApp runtime policy wiring.");
