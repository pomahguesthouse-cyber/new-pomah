import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_REGEN_COOLDOWN_MS,
  parseStructuredSummary,
  shouldForceSummary,
} from "../src/services/wa-autoreply/session-summary-policy";
import { threadSummaryRefreshDue } from "../src/services/whatsapp-summary.service";

assert.equal(SUMMARY_REGEN_COOLDOWN_MS, 3 * 60 * 1000);
assert.equal(shouldForceSummary("Halo Kak"), false);
assert.equal(shouldForceSummary("Saya mau booking deluxe tanggal 15"), true);
assert.equal(shouldForceSummary("Ada bukti transfer"), true);
assert.equal(shouldForceSummary("Kamarnya kotor"), true);

assert.equal(parseStructuredSummary(""), null);
assert.equal(parseStructuredSummary("bukan json"), null);
assert.equal(parseStructuredSummary('{"short_summary":""}'), null);

const parsed = parseStructuredSummary(`\`\`\`json
{
  "short_summary": "Tamu menanyakan kamar Deluxe.",
  "guest_name": "  Budi  ",
  "last_topic": "booking",
  "room_type": "Deluxe",
  "check_in": "2026-07-15",
  "check_out": "2026-07-16",
  "guest_count": 2,
  "booking_status": "pending",
  "payment_status": "unpaid",
  "complaint_active": false,
  "unresolved_question": null,
  "needs_human": false,
  "handoff_reason": null
}
\`\`\``);
assert.ok(parsed);
assert.equal(parsed.short_summary, "Tamu menanyakan kamar Deluxe.");
assert.equal(parsed.guest_name, "Budi");
assert.equal(parsed.last_topic, "booking");
assert.equal(parsed.booking_status, "pending");
assert.equal(parsed.payment_status, "unpaid");
assert.equal(parsed.guest_count, 2);

const embedded = parseStructuredSummary('hasil: {"short_summary":"Ringkas","last_topic":"unknown"} selesai');
assert.ok(embedded);
assert.equal(embedded.short_summary, "Ringkas");
assert.equal(embedded.last_topic, null);

const oversized = parseStructuredSummary(JSON.stringify({ short_summary: "x".repeat(SUMMARY_MAX_CHARS + 50) }));
assert.ok(oversized);
assert.equal(oversized.short_summary.length, SUMMARY_MAX_CHARS);
assert.equal(oversized.short_summary.endsWith("…"), true);

const serviceSource = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.ok(
  serviceSource.includes('from "@/services/wa-autoreply/session-summary-policy"'),
  "wa-autoreply.service.ts must import session-summary-policy",
);
for (const forbidden of [
  "const SUMMARY_REGEN_COOLDOWN_MS =",
  "const FORCE_SUMMARY_KEYWORDS:",
  "function shouldForceSummary(",
]) {
  assert.equal(
    serviceSource.includes(forbidden),
    false,
    `wa-autoreply.service.ts still duplicates summary policy: ${forbidden}`,
  );
}

{
  const now = new Date("2026-10-09T12:00:00.000Z");
  const recent = new Date(now.getTime() - 30_000).toISOString();
  const staleMessage = new Date(now.getTime() - 10 * 60_000).toISOString();
  const oldSummary = new Date(now.getTime() - 20 * 60_000).toISOString();
  assert.equal(
    threadSummaryRefreshDue({ last_message_at: staleMessage, chat_summary_updated_at: null }, now),
    true,
    "thread tanpa ringkasan dan pesan yang sudah lewat margin ikut di-refresh",
  );
  assert.equal(
    threadSummaryRefreshDue({ last_message_at: recent, chat_summary_updated_at: null }, now),
    false,
    "pesan yang baru saja masuk menunggu margin supaya tidak balapan",
  );
  assert.equal(
    threadSummaryRefreshDue(
      { last_message_at: staleMessage, chat_summary_updated_at: oldSummary },
      now,
    ),
    true,
    "pesan baru setelah ringkasan lama ikut di-refresh",
  );
  assert.equal(
    threadSummaryRefreshDue(
      { last_message_at: oldSummary, chat_summary_updated_at: staleMessage },
      now,
    ),
    false,
  );
  assert.equal(threadSummaryRefreshDue({ last_message_at: null, chat_summary_updated_at: null }, now), false);
}

console.log("✓ WhatsApp session summary policy regressions and wiring cases passed");
