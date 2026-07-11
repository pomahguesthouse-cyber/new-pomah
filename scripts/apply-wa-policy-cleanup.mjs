import fs from "node:fs";

function replaceRequired(path, before, after, label) {
  let source = fs.readFileSync(path, "utf8");
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Unable to find ${label} in ${path}`);
  }
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}

const servicePath = "src/services/wa-autoreply.service.ts";
let service = fs.readFileSync(servicePath, "utf8");

const summaryImportAnchor = `import {
  generateSessionSummary,
  regenerateThreadSummary,
  SUMMARY_MIN_MESSAGES,
  updateThreadSummary,
} from "@/services/wa-autoreply/session-summary";`;

const summaryPolicyImport = `import {
  SUMMARY_REGEN_COOLDOWN_MS,
  shouldForceSummary,
} from "@/services/wa-autoreply/session-summary-policy";`;

if (!service.includes(summaryImportAnchor)) {
  throw new Error("Unable to find session-summary import anchor");
}
if (!service.includes(summaryPolicyImport)) {
  service = service.replace(summaryImportAnchor, `${summaryImportAnchor}\n${summaryPolicyImport}`);
}

const summaryBlockStart = service.indexOf("// ── Summarizer tuning knobs");
const summaryBlockEnd = service.indexOf("function shouldLoadHeavyRetrieval(", summaryBlockStart);
if (summaryBlockStart >= 0) {
  if (summaryBlockEnd < 0) {
    throw new Error("Unable to find end of duplicated summary policy block");
  }
  service = service.slice(0, summaryBlockStart) + service.slice(summaryBlockEnd);
}

for (const forbidden of [
  "const SUMMARY_REGEN_COOLDOWN_MS =",
  "const FORCE_SUMMARY_KEYWORDS:",
  "function shouldForceSummary(",
]) {
  if (service.includes(forbidden)) {
    throw new Error(`Summary policy duplicate remains: ${forbidden}`);
  }
}

if (!service.includes('from "@/services/wa-autoreply/session-summary-policy"')) {
  throw new Error("Summary policy import was not added");
}
fs.writeFileSync(servicePath, service);

replaceRequired(
  "src/public/components/public-shell.tsx",
  '{ to: "/rooms", label: "Kamar" },',
  '{ to: "/", hash: "rooms", label: "Kamar" },',
  "footer rooms link",
);

replaceRequired(
  "src/public/components/public-shell.tsx",
  '<Link to={l.to} className="text-teal-200/80 transition hover:text-white">',
  '<Link\n                    to={l.to}\n                    hash={"hash" in l ? l.hash : undefined}\n                    className="text-teal-200/80 transition hover:text-white"\n                  >',
  "footer navigation Link",
);

for (const temporaryScript of [
  "scripts/apply-wa-runtime-policy-wiring.mjs",
  "scripts/apply-wa-session-summary-io-refactor.mjs",
  "scripts/apply-tanstack-router-followup.mjs",
  "scripts/apply-tanstack-router-typecheck-fix.mjs",
  "scripts/apply-wa-policy-cleanup.mjs",
]) {
  if (fs.existsSync(temporaryScript)) fs.rmSync(temporaryScript);
}

console.log("Applied final WhatsApp policy cleanup.");
