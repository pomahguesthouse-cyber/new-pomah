import { readFileSync, writeFileSync } from "node:fs";

const path = "src/services/wa-autoreply.service.ts";
let source = readFileSync(path, "utf8");

const formatterImport = `import {
  buildAvailabilityNeedDatesReply,
  formatAvailabilityForGuestCount,
  formatAvailabilityReply,
  lastBotAskedGuestCount,
} from "@/services/wa-autoreply/availability-formatters";`;

if (!source.includes(formatterImport)) {
  const parserImportEnd = `} from "@/services/wa-autoreply/message-parsers";`;
  const occurrences = source.split(parserImportEnd).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one message-parsers import terminator, found ${occurrences}`);
  }
  source = source.replace(parserImportEnd, `${parserImportEnd}\n${formatterImport}`);
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
  "function buildAvailabilityNeedDatesReply(",
  "function buildRecentAvailabilityNeedDatesReply(",
  "buildAvailabilityNeedDatesReply",
);
removeBetween(
  "function formatAvailabilityReply(",
  "function lastBotAskedGuestCount(",
  "formatAvailabilityReply",
);
removeBetween(
  "function lastBotAskedGuestCount(",
  "function formatAvailabilityForGuestCount(",
  "lastBotAskedGuestCount",
);
removeBetween(
  "function formatAvailabilityForGuestCount(",
  "/** Heuristik ringan: pesan tamu bernada booking_inquiry",
  "formatAvailabilityForGuestCount",
);

for (const name of [
  "buildAvailabilityNeedDatesReply",
  "formatAvailabilityReply",
  "lastBotAskedGuestCount",
  "formatAvailabilityForGuestCount",
]) {
  if (source.includes(`function ${name}(`)) {
    throw new Error(`${name} still has a local implementation`);
  }
}

writeFileSync(path, source);
console.log("Applied guarded availability formatter extraction.");
