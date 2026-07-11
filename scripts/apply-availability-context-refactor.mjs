import { readFileSync, writeFileSync } from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = readFileSync(path, "utf8");

const contextImport = `import {
  buildRecentAvailabilityNeedDatesReply,
  formatTonightAvailabilityReply,
} from "@/services/wa-autoreply/availability-context";`;

if (!source.includes(contextImport)) {
  const anchor = `} from "@/services/wa-autoreply/availability-formatters";`;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Expected one availability formatter import, found ${count}`);
  source = source.replace(anchor, `${anchor}\n${contextImport}`);
}

function removeBetween(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Unable to isolate ${label}`);
  source = `${source.slice(0, start)}${source.slice(end)}`;
}

removeBetween(
  "function buildRecentAvailabilityNeedDatesReply(",
  "/** Heuristik ringan: pesan tamu bernada booking_inquiry",
  "buildRecentAvailabilityNeedDatesReply",
);

const tonightStart = source.indexOf("async function buildTonightPriceReply(");
const summaryMarker = "/** Hard cap on persisted `short_summary` length";
const tonightEnd = source.indexOf(summaryMarker, tonightStart);
if (tonightStart < 0 || tonightEnd < 0) throw new Error("Unable to isolate buildTonightPriceReply");

const oldTonight = source.slice(tonightStart, tonightEnd);
const dataMarker = "  const data = JSON.parse(raw) as {";
const dataStart = oldTonight.indexOf(dataMarker);
if (dataStart < 0) throw new Error("Unable to locate tonight response formatting block");

const preservedPrefix = oldTonight.slice(0, dataStart).trimEnd();
if (!preservedPrefix.includes("const raw = await checkRoomAvailability(")) {
  throw new Error("Unable to confirm tonight availability call");
}

const replacement = `${preservedPrefix}\n\n  return formatTonightAvailabilityReply(raw, checkIn, checkOut);\n}\n`;
source = `${source.slice(0, tonightStart)}${replacement}\n${source.slice(tonightEnd)}`;

if (source.includes("function buildRecentAvailabilityNeedDatesReply(")) {
  throw new Error("buildRecentAvailabilityNeedDatesReply still defined locally");
}
if (!source.includes("return formatTonightAvailabilityReply(raw, checkIn, checkOut);")) {
  throw new Error("buildTonightPriceReply was not rewired");
}

writeFileSync(path, source);
console.log("Applied guarded availability context extraction.");
