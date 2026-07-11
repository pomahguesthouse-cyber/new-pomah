import fs from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = fs.readFileSync(path, "utf8");

const importAnchor = 'import { buildPropertyFaqReply } from "@/services/property-faq";';
const ioImport = `import {\n  generateSessionSummary,\n  regenerateThreadSummary,\n  updateThreadSummary,\n} from "@/services/wa-autoreply/session-summary";`;

if (!source.includes(importAnchor)) throw new Error("Unable to find import anchor");
if (!source.includes(ioImport)) {
  source = source.replace(importAnchor, `${importAnchor}\n${ioImport}`);
}

source = source.replace(
  'import { chatCompletionText } from "@/services/ai-client.service";\n',
  "",
);

const startCandidates = [
  '/** Below this many messages, summarizing is pointless — skip. */',
  'const SUMMARY_MIN_MESSAGES = 3;',
];
let start = -1;
for (const marker of startCandidates) {
  start = source.indexOf(marker);
  if (start >= 0) break;
}
if (start < 0) throw new Error("Unable to find session summary IO block start");

const endMarker = "export async function executeAutoreplyForPhone(";
const end = source.indexOf(endMarker, start);
if (end < 0) throw new Error("Unable to find session summary IO block end");

source =
  source.slice(0, start) +
  `export { regenerateThreadSummary };\n\n` +
  source.slice(end);

fs.writeFileSync(path, source);
console.log("Applied guarded WhatsApp session summary IO extraction.");
