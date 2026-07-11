import assert from "node:assert/strict";
import {
  SUMMARY_MIN_MESSAGES,
  updateThreadSummary,
} from "../src/services/wa-autoreply/session-summary";

assert.equal(SUMMARY_MIN_MESSAGES, 3);

const structured = {
  short_summary: "Tamu menanyakan kamar Deluxe.",
  guest_name: null,
  last_topic: "availability" as const,
  room_type: "Deluxe",
  check_in: "2026-07-15",
  check_out: "2026-07-16",
  guest_count: 2,
  booking_status: "none" as const,
  payment_status: null,
  complaint_active: false,
  unresolved_question: null,
  needs_human: false,
  handoff_reason: null,
};

const updates: Array<Record<string, unknown>> = [];
const client = {
  from(table: string) {
    if (table !== "whatsapp_threads") throw new Error(`unexpected table ${table}`);
    return {
      select() {
        return {
          eq() {
            return {
              async maybeSingle() {
                return { data: { chat_summary_version: 4 } };
              },
            };
          },
        };
      },
      update(patch: Record<string, unknown>) {
        updates.push(patch);
        return {
          async eq() {
            return { error: null };
          },
        };
      },
    };
  },
};

await updateThreadSummary(client, "thread-1", structured);
assert.equal(updates[0].chat_summary, structured.short_summary);
assert.equal(updates[0].chat_summary_version, 5);
assert.deepEqual(updates[0].chat_summary_json, structured);

await updateThreadSummary(client, "thread-1", structured, { jsonOnly: true });
assert.equal("chat_summary" in updates[1], false);
assert.equal(updates[1].chat_summary_version, 5);
assert.deepEqual(updates[1].chat_summary_json, structured);

console.log("✓ WhatsApp session summary IO regressions passed");
