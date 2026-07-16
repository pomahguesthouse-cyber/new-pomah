import assert from "node:assert/strict";
import { pickNotificationThread } from "../src/services/notification-thread-resolver";

const splitThread = pickNotificationThread(
  [
    {
      id: "notification-only",
      phone: "6289673282331",
      last_message_at: "2026-07-16T01:53:14.000Z",
    },
    {
      id: "active-lid-thread",
      phone: "111111111111111",
      canonical_phone: "6289673282331",
      external_chat_id: "111111111111111@lid",
      last_message_at: "2026-07-16T01:40:00.000Z",
    },
  ],
  "089673282331",
);
assert.equal(
  splitThread?.id,
  "active-lid-thread",
  "canonical WhatsApp identity must beat a newer notification-only phone thread",
);

const newestCanonical = pickNotificationThread(
  [
    {
      id: "older",
      canonical_phone: "628123456789",
      last_message_at: "2026-07-15T00:00:00.000Z",
    },
    {
      id: "newer",
      canonical_phone: "628123456789",
      last_message_at: "2026-07-16T00:00:00.000Z",
    },
  ],
  "+62 812-3456-789",
);
assert.equal(newestCanonical?.id, "newer", "latest activity must break equal identity matches");

assert.equal(pickNotificationThread([], "08123456789"), null);
assert.equal(pickNotificationThread([{ id: "other", phone: "628999" }], "08123456789"), null);

console.log("notification-thread resolver regressions: OK");
