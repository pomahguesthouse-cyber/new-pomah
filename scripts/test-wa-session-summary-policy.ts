import assert from "node:assert/strict";
import {
  SUMMARY_MAX_CHARS,
  parseStructuredSummary,
  shouldForceSummary,
} from "../src/services/wa-autoreply/session-summary-policy";

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

console.log("✓ WhatsApp session summary policy regressions passed");
