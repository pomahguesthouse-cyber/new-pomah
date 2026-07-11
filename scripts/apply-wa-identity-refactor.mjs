import { readFileSync, writeFileSync } from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = readFileSync(path, "utf8");

const identityImport = `import {
  isConfiguredAdminPhone,
  isManagerInGuestMode,
  normalizePhone,
  resolveManagerByPhone,
} from "@/services/wa-autoreply/identity";

export {
  isConfiguredAdminPhone,
  isManagerInGuestMode,
  normalizePhone,
  resolveManagerByPhone,
};`;

if (!source.includes(identityImport)) {
  const anchor = `} from "@/services/wa-autoreply/availability-context";`;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Expected one availability-context import, found ${count}`);
  source = source.replace(anchor, `${anchor}\n${identityImport}`);
}

const startMarker = "/** Normalize an Indonesian phone to digits-only with 62 prefix. */";
const endMarker = "export type AutoreplyOutcome =";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0 || end <= start) {
  throw new Error("Unable to isolate local WhatsApp identity helpers");
}

source = `${source.slice(0, start)}${source.slice(end)}`;

for (const localDefinition of [
  "function normalizePhone(",
  "export function isConfiguredAdminPhone(",
  "export async function resolveManagerByPhone(",
  "export async function isManagerInGuestMode(",
]) {
  if (source.includes(localDefinition)) {
    throw new Error(`Local definition remains: ${localDefinition}`);
  }
}

if (!source.includes('from "@/services/wa-autoreply/identity"')) {
  throw new Error("Identity module import was not added");
}

writeFileSync(path, source);
console.log("Applied guarded WhatsApp identity extraction.");
