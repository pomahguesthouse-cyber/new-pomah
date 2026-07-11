import fs from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = fs.readFileSync(path, "utf8");

const importAnchor = 'import { buildPropertyFaqReply } from "@/services/property-faq";';
const runtimePolicyImport = `import {
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
if (!source.includes('from "@/services/wa-autoreply/runtime-policy"')) {
  source = source.replace(importAnchor, `${importAnchor}\n${runtimePolicyImport}`);
}

function removeRange(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0) {
    // Idempotent reruns are allowed when the declarations are already gone.
    return;
  }
  if (end < 0) {
    throw new Error(`Unable to find end of duplicated ${label} block`);
  }
  source = source.slice(0, start) + source.slice(end);
}

removeRange(
  "const FALLBACK_MESSAGE =",
  "const QUICK_ACK_AFTER_MS = 6_000;",
  "fallback policy",
);

removeRange(
  "const AI_TIMEOUT_MS = 18_000;",
  "const HANDLE_ONE_DEADLINE_MS = 26_000;",
  "timeout policy",
);

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
