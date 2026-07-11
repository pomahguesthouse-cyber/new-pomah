import { readFileSync, writeFileSync } from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = readFileSync(path, "utf8");

const runtimeImport = `import {
  AI_TIMEOUT_MS,
  FALLBACK_MESSAGE,
  MANAGER_FALLBACK_MESSAGE,
  QUICK_ACK_MESSAGE,
  buildStateAwareFallback,
  pickAiBudgetMs,
} from "@/services/wa-autoreply/runtime-policy";`;

if (!source.includes(runtimeImport)) {
  const anchor = `} from "@/services/wa-autoreply/identity";`;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Expected one identity import, found ${count}`);
  source = source.replace(anchor, `${anchor}\n${runtimeImport}`);
}

function removeBetween(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to isolate ${label}`);
  }
  source = `${source.slice(0, start)}${source.slice(end)}`;
}

removeBetween(
  "const FALLBACK_MESSAGE =",
  "const QUICK_ACK_AFTER_MS = 6_000;",
  "fallback constants and buildStateAwareFallback",
);

removeBetween(
  "/**\n * Anggaran waktu untuk SATU attempt orchestrasi penuh",
  "// Deadline dinding-jam untuk satu iterasi handleOne",
  "AI timeout policy",
);

if (source.includes("function buildStateAwareFallback(")) {
  throw new Error("buildStateAwareFallback still defined locally");
}
if (source.includes("function pickAiBudgetMs(")) {
  throw new Error("pickAiBudgetMs still defined locally");
}
if (!source.includes(runtimeImport)) {
  throw new Error("Runtime policy import was not added");
}

writeFileSync(path, source);
console.log("Applied guarded WhatsApp runtime policy extraction.");
