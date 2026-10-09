/**
 * Booking-stuck monitor + staff notification channel.
 *
 *  - sesi wa_booking_states lebih tua dari 24 jam diabaikan
 *  - awal episode lebih tua dari 24 jam diabaikan
 *  - alerted hanya naik bila notify mengembalikan sent=true
 *  - beberapa thread untuk satu nomor memakai thread dengan pesan terbaru
 *  - notification_logs pending > 10 menit dicoba ulang; yang lebih baru di-skip
 */
import assert from "node:assert/strict";
import {
  STUCK_LOOKBACK_MS,
  isWithinLookback,
  pickThreadWithLatestMessage,
  runBookingStuckMonitor,
} from "../src/services/booking-stuck-monitor";
import {
  PENDING_STALE_MS,
  STAFF_NOTIFY_RETRY_DELAYS_MS,
  isRetryablePendingLog,
  sendWithRetry,
} from "../src/services/manager-notifier.service";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const PHONE = "628111111111";

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function makeMonitorDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Array<(row: any) => boolean> = [];
      let sortCol: string | null = null;
      let sortAsc = true;
      let lim = Infinity;
      const b: any = {
        select: () => b,
        order(col: string, opts?: { ascending?: boolean }) {
          sortCol = col;
          sortAsc = opts?.ascending !== false;
          return b;
        },
        limit(n: number) {
          lim = n;
          return b;
        },
        in(col: string, vals: unknown[]) {
          filters.push((row) => vals.includes(row[col]));
          return b;
        },
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return b;
        },
        lt(col: string, val: string) {
          filters.push((row) => String(row[col]) < val);
          return b;
        },
        gte(col: string, val: string) {
          filters.push((row) => String(row[col]) >= val);
          return b;
        },
        then(resolve: (value: { data: any[]; error: null }) => void) {
          let out = rows.filter((row) => filters.every((fn) => fn(row)));
          if (sortCol) {
            const col = sortCol;
            out = [...out].sort((a, b) => {
              const av = String(a[col] ?? "");
              const bv = String(b[col] ?? "");
              return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          }
          resolve({ data: out.slice(0, lim), error: null });
        },
      };
      return b;
    },
  };
}

function stuckState(updatedAgoMs: number) {
  return {
    phone: PHONE,
    state: "AWAITING_EMAIL",
    updated_at: iso(updatedAgoMs),
    context: { guestName: "Sari" },
  };
}

function inbound(sentAgoMs: number, threadId: string, body = "email saya") {
  return {
    id: `in-${threadId}-${sentAgoMs}`,
    thread_id: threadId,
    direction: "in",
    body,
    sent_at: iso(sentAgoMs),
  };
}

async function runMonitor(
  tables: Record<string, any[]>,
  notifyImpl: (db: unknown, opts: any) => Promise<boolean>,
) {
  const calls: any[] = [];
  const result = await runBookingStuckMonitor(makeMonitorDb(tables) as any, {
    now: NOW,
    notify: async (db, opts) => {
      calls.push(opts);
      return notifyImpl(db, opts);
    },
  });
  return { result, calls };
}

// ─── lookback + latest thread helpers ────────────────────────────────────────

assert.equal(isWithinLookback(iso(60_000), NOW), true);
assert.equal(isWithinLookback(iso(STUCK_LOOKBACK_MS + 60_000), NOW), false);
assert.equal(isWithinLookback("not-a-date", NOW), false);

const picked = pickThreadWithLatestMessage([
  { id: "older", phone: PHONE, last_message_at: iso(3 * 60 * 60 * 1000) },
  { id: "newer", phone: PHONE, last_message_at: iso(5 * 60 * 1000) },
  { id: "blank", phone: PHONE, last_message_at: null },
]);
assert.equal(picked.get(PHONE), "newer");

// ─── monitor ignores sessions older than 24h ─────────────────────────────────

{
  const { result, calls } = await runMonitor(
    {
      wa_booking_states: [stuckState(25 * 60 * 60 * 1000)],
      whatsapp_threads: [{ id: "t-old", phone: PHONE, last_message_at: iso(25 * 60 * 60 * 1000) }],
      whatsapp_messages: [inbound(25 * 60 * 60 * 1000, "t-old")],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => true,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.checked, 0);
    assert.equal(result.alerted, 0);
  }
  assert.equal(calls.length, 0, "stale session must not notify");
}

{
  const { result, calls } = await runMonitor(
    {
      wa_booking_states: [stuckState(2 * 60 * 60 * 1000)],
      whatsapp_threads: [{ id: "t-ep", phone: PHONE, last_message_at: iso(2 * 60 * 60 * 1000) }],
      whatsapp_messages: [
        inbound(2 * 60 * 60 * 1000, "t-ep", "masih nunggu"),
        inbound(30 * 60 * 60 * 1000, "t-ep", "awal episode"),
      ],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => true,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.alerted, 0);
  assert.equal(calls.length, 0, "episode older than 24h must not notify");
}

// ─── alerted counts only real sends ──────────────────────────────────────────

{
  const { result, calls } = await runMonitor(
    {
      wa_booking_states: [stuckState(5 * 60 * 1000)],
      whatsapp_threads: [{ id: "t-live", phone: PHONE, last_message_at: iso(5 * 60 * 1000) }],
      whatsapp_messages: [inbound(5 * 60 * 1000, "t-live")],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => false,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.checked, 1);
    assert.equal(result.alerted, 0);
  }
  assert.equal(calls.length, 1);
}

{
  const { result } = await runMonitor(
    {
      wa_booking_states: [stuckState(5 * 60 * 1000)],
      whatsapp_threads: [{ id: "t-live", phone: PHONE, last_message_at: iso(5 * 60 * 1000) }],
      whatsapp_messages: [inbound(5 * 60 * 1000, "t-live")],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => true,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.alerted, 1);
}

// ─── multiple threads: latest message wins ───────────────────────────────────

{
  const { calls } = await runMonitor(
    {
      wa_booking_states: [stuckState(10 * 60 * 1000)],
      whatsapp_threads: [
        { id: "thread-old", phone: PHONE, last_message_at: iso(2 * 60 * 60 * 1000) },
        { id: "thread-new", phone: PHONE, last_message_at: iso(4 * 60 * 1000) },
      ],
      whatsapp_messages: [
        inbound(2 * 60 * 60 * 1000, "thread-old", "macet di thread lama"),
        { id: "out-new", thread_id: "thread-new", direction: "out", body: "sudah dibalas", sent_at: iso(4 * 60 * 1000) },
      ],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => true,
  );
  assert.equal(calls.length, 0, "latest thread already has an outbound reply");
}

{
  const { calls, result } = await runMonitor(
    {
      wa_booking_states: [stuckState(10 * 60 * 1000)],
      whatsapp_threads: [
        { id: "thread-old", phone: PHONE, last_message_at: iso(3 * 60 * 60 * 1000) },
        { id: "thread-new", phone: PHONE, last_message_at: iso(6 * 60 * 1000) },
      ],
      whatsapp_messages: [
        inbound(6 * 60 * 1000, "thread-new", "dari thread baru"),
        inbound(3 * 60 * 60 * 1000, "thread-old", "dari thread lama"),
      ],
      handoff_tickets: [],
      wa_conversation_queue: [],
    },
    async () => true,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].threadId, "thread-new");
  assert.equal(calls[0].lastInboundBody, "dari thread baru");
  if (result.ok) assert.equal(result.alerted, 1);
}

// ─── pending > 10 min is retried; a fresh pending is not ─────────────────────

assert.equal(PENDING_STALE_MS, 10 * 60 * 1000);
assert.equal(
  isRetryablePendingLog({ status: "pending", created_at: new Date(NOW - PENDING_STALE_MS - 1000).toISOString() }, NOW),
  true,
);
assert.equal(
  isRetryablePendingLog({ status: "pending", created_at: new Date(NOW - 60_000).toISOString() }, NOW),
  false,
);
assert.equal(isRetryablePendingLog({ status: "sent", created_at: iso(60 * 60 * 1000) }, NOW), false);
assert.equal(isRetryablePendingLog({ status: "pending", created_at: null }, NOW), true);

function makeLogDb(initial: any[]) {
  const logs = initial.map((row) => ({ ...row }));
  const updates: any[] = [];
  return {
    logs,
    updates,
    from(table: string) {
      if (table !== "notification_logs") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const b: any = {
        select: () => b,
        eq(col: string, val: unknown) {
          filters[col] = val;
          return b;
        },
        maybeSingle: async () => {
          const row = logs.find((item) => Object.entries(filters).every(([k, v]) => item[k] === v));
          return { data: row ?? null, error: null };
        },
        insert(row: any) {
          const stored = { id: `new-${logs.length + 1}`, ...row };
          logs.push(stored);
          return {
            select: () => ({
              single: async () => ({ data: { id: stored.id }, error: null }),
            }),
          };
        },
        update(patch: any) {
          return {
            eq(_col: string, id: string) {
              const row = logs.find((item) => item.id === id);
              if (row) Object.assign(row, patch);
              updates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return b;
    },
  };
}

const savedDelays = [...STAFF_NOTIFY_RETRY_DELAYS_MS];
STAFF_NOTIFY_RETRY_DELAYS_MS.splice(0, STAFF_NOTIFY_RETRY_DELAYS_MS.length, 0, 0, 0);

const admin = { id: "admin-1", name: "Owner", phone: "628123", role: "super_admin" };
const baseOpts = {
  eventType: "booking_stuck" as const,
  recipient: admin,
  message: "macet",
  dedupeKey: "booking_stuck:test",
  channel: "wa" as const,
};

{
  const db = makeLogDb([
    {
      id: "pending-stale",
      status: "pending",
      created_at: new Date(Date.now() - PENDING_STALE_MS - 60_000).toISOString(),
      dedupe_key: baseOpts.dedupeKey,
      channel: "wa",
    },
  ]);
  const attempts: string[] = [];
  const sent = await sendWithRetry(db as any, "wa-token", baseOpts, async (opts) => {
    attempts.push(opts.channel);
    return { ok: true };
  });
  assert.equal(sent, true);
  assert.deepEqual(attempts, ["wa"]);
  assert.equal(db.logs[0].status, "sent");
  assert.equal(db.logs.length, 1, "stale pending reuses the existing row");
}

{
  const db = makeLogDb([
    {
      id: "pending-fresh",
      status: "pending",
      created_at: new Date().toISOString(),
      dedupe_key: baseOpts.dedupeKey,
      channel: "wa",
    },
  ]);
  let attempts = 0;
  const sent = await sendWithRetry(db as any, "wa-token", baseOpts, async () => {
    attempts += 1;
    return { ok: true };
  });
  assert.equal(sent, false);
  assert.equal(attempts, 0);
  assert.equal(db.logs[0].status, "pending");
  assert.equal(db.updates.length, 0);
}

STAFF_NOTIFY_RETRY_DELAYS_MS.splice(0, STAFF_NOTIFY_RETRY_DELAYS_MS.length, ...savedDelays);

console.log("booking-stuck monitor: OK");
