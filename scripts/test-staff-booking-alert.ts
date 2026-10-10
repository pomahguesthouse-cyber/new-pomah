/**
 * Alert WhatsApp booking baru ke staf: parameter template, strategi kirim,
 * status webhook, dan pemilihan recovery. Tidak mengirim WhatsApp.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAFF_NOTIFY_RETRY_DELAYS_MS, sendWithRetry, awaitNotifyNewBooking } from "../src/services/manager-notifier.service";
import {
  STAFF_ALERT_RECOVERY_LOOKBACK_MS,
  STAFF_ALERT_RECOVERY_MIN_AGE_MS,
  STAFF_BOOKING_TEMPLATE_BODY,
  applyNotificationLogDeliveryStatus,
  buildStaffBookingAlert,
  decideNotificationLogStatusUpdate,
  findReengagementCode,
  formatStaffRoomLabel,
  formatStaffRooms,
  isCutOffPendingLog,
  resolveStaffBookingTemplate,
  selectStaffAlertRecoveryTargets,
  selectStaffBookingSendMode,
  staffAlertDedupeKey,
} from "../src/services/staff-booking-alert";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("test must not perform a real WhatsApp or HTTP send");
}) as typeof fetch;

const savedDelays = [...STAFF_NOTIFY_RETRY_DELAYS_MS];
STAFF_NOTIFY_RETRY_DELAYS_MS.splice(0, STAFF_NOTIFY_RETRY_DELAYS_MS.length, 0, 0, 0, 0);

function restoreDelays() {
  STAFF_NOTIFY_RETRY_DELAYS_MS.splice(0, STAFF_NOTIFY_RETRY_DELAYS_MS.length, ...savedDelays);
  globalThis.fetch = originalFetch;
}

const baseInput = {
  referenceCode: "PG-2211",
  guestName: "Sari",
  rooms: [{ room_types: { name: "Deluxe" } }, { room_types: { name: "Deluxe" } }],
  checkIn: "2026-11-21",
  checkOut: "2026-11-23",
  nights: 2,
  totalAmount: 460_000,
  paidAmount: 0,
  paymentStatus: "unpaid",
  paymentMethod: null,
};

{
  const alert = buildStaffBookingAlert(baseInput);
  assert.equal(alert.params.length, 9);
  assert.deepEqual(alert.params, [
    "PG-2211",
    "Sari",
    "2x Deluxe",
    "Sab, 21 Nov 2026",
    "Sen, 23 Nov 2026",
    "2",
    "Rp460.000",
    "DP 50% Rp230.000 belum dibayar",
    "Rp460.000",
  ]);
  assert.match(alert.message, /Total: Rp460\.000/);
  assert.match(alert.message, /DP\/Pembayaran: DP 50% Rp230\.000 belum dibayar/);
  assert.match(alert.message, /Sisa: Rp460\.000/);
  assert.doesNotMatch(alert.message, /Source:|Sumber:/);
  for (const value of alert.params) {
    assert.equal(value.length > 0, true);
    assert.doesNotMatch(value, /[\r\n\t]/);
    assert.doesNotMatch(value, / {5}/);
  }
}

{
  const partial = buildStaffBookingAlert({
    ...baseInput,
    paidAmount: 230_000,
    paymentStatus: "partial",
  });
  assert.equal(partial.params[7], "Rp230.000");
  assert.equal(partial.params[8], "Rp230.000");
}

{
  const short = buildStaffBookingAlert({
    ...baseInput,
    paidAmount: 100_000,
    paymentStatus: "partial",
    nights: 3,
  });
  assert.equal(short.params[7], "Rp100.000 (DP 50% Rp230.000 belum lunas)");
  assert.equal(short.params[8], "Rp360.000");
}

{
  const onsite = buildStaffBookingAlert({
    ...baseInput,
    nights: 1,
    checkOut: "2026-11-22",
    paymentMethod: "onsite",
    totalAmount: 200_000,
  });
  assert.equal(onsite.params[5], "1");
  assert.equal(onsite.params[7], "Bayar di tempat");
  assert.equal(onsite.params[8], "Rp200.000");
}

{
  const unmarkedOneNight = buildStaffBookingAlert({
    ...baseInput,
    nights: 1,
    checkOut: "2026-11-22",
    paymentMethod: null,
    totalAmount: 200_000,
  });
  assert.equal(unmarkedOneNight.params[7], "Bayar di tempat");
}

{
  const transfer = buildStaffBookingAlert({
    ...baseInput,
    nights: 1,
    checkOut: "2026-11-22",
    paymentMethod: "transfer",
    totalAmount: 200_000,
  });
  assert.equal(transfer.params[7], "Belum bayar");
  assert.equal(transfer.params[8], "Rp200.000");
}

{
  const fromPayments = buildStaffBookingAlert({
    ...baseInput,
    paidAmount: 0,
    payments: [
      { amount: 50_000, status: "failed" },
      { amount: 230_000, status: "paid" },
    ],
  });
  assert.equal(fromPayments.params[7], "Rp230.000");
  assert.equal(fromPayments.params[8], "Rp230.000");
}

{
  const dirty = buildStaffBookingAlert({
    ...baseInput,
    guestName: "A\nB\tC     D",
    referenceCode: "   ",
    bookingId: "",
    rooms: [],
    checkIn: "bukan-tanggal",
  });
  assert.equal(dirty.params[0], "-");
  assert.equal(dirty.params[1], "A B C    D");
  assert.equal(dirty.params[2], "-");
  assert.equal(dirty.params[3], "-");
  assert.doesNotMatch(dirty.params[1], /[\r\n\t]/);
  assert.doesNotMatch(dirty.params[1], / {5}/);
}

assert.equal(formatStaffRoomLabel(2, "Deluxe"), "2x Deluxe");
assert.equal(formatStaffRoomLabel(2, "2x Deluxe"), "2x Deluxe");
assert.equal(formatStaffRoomLabel(2, "2x  Deluxe"), "2x Deluxe");
assert.doesNotMatch(formatStaffRoomLabel(2, "2x Deluxe"), /2x\s+2x/);
assert.equal(
  formatStaffRooms([
    { room_types: { name: "2x Deluxe" } },
    { room_types: { name: "Deluxe" } },
  ]),
  "2x Deluxe",
);
assert.equal(formatStaffRooms([]), "-");

assert.equal(selectStaffBookingSendMode({}), "template");
assert.deepEqual(resolveStaffBookingTemplate({}), { name: "new_booking_alert", lang: "id" });
assert.equal(selectStaffBookingSendMode({ WHATSAPP_STAFF_BOOKING_TEMPLATE_NAME: "" }), "text");
assert.equal(resolveStaffBookingTemplate({ WHATSAPP_STAFF_BOOKING_TEMPLATE_NAME: "  " }), null);
assert.deepEqual(
  resolveStaffBookingTemplate({
    WHATSAPP_STAFF_BOOKING_TEMPLATE_NAME: " staff_alert ",
    WHATSAPP_STAFF_BOOKING_TEMPLATE_LANG: "en",
  }),
  { name: "staff_alert", lang: "en" },
);
assert.equal(
  resolveStaffBookingTemplate({ WHATSAPP_STAFF_BOOKING_TEMPLATE_NAME: "new_booking_alert" })?.lang,
  "id",
);
assert.equal(STAFF_BOOKING_TEMPLATE_BODY.includes("{{9}}"), true);
assert.doesNotMatch(STAFF_BOOKING_TEMPLATE_BODY, /sumber|Sumber|source/i);

assert.equal(staffAlertDedupeKey("book-1", "mgr-1"), "new_booking:book-1:mgr-1");

{
  const now = Date.parse("2026-10-10T12:00:00.000Z");
  const age = (ms: number) => new Date(now - ms).toISOString();
  const managers = [
    { id: "titik", phone: "628111", is_active: true, is_muted: true },
    { id: "faizal", phone: "628222", is_active: true, is_muted: false },
    { id: "off", phone: "628333", is_active: false },
    { id: "nophone", phone: "  ", is_active: true },
  ];
  const bookingId = "book-1";
  const targets = selectStaffAlertRecoveryTargets({
    now,
    managers,
    bookings: [
      { id: bookingId, status: "pending", created_at: age(10 * 60 * 1000) },
      { id: "too-new", status: "confirmed", created_at: age(30 * 1000) },
      { id: "too-old", status: "confirmed", created_at: age(STAFF_ALERT_RECOVERY_LOOKBACK_MS + 60_000) },
      { id: "cancelled", status: "cancelled", created_at: age(10 * 60 * 1000) },
      { id: "done", status: "confirmed", created_at: age(STAFF_ALERT_RECOVERY_MIN_AGE_MS + 1000) },
    ],
    logs: [
      { dedupe_key: staffAlertDedupeKey(bookingId, "faizal"), status: "pending", attempts: 0, channel: "wa" },
      { dedupe_key: staffAlertDedupeKey("done", "titik"), status: "sent", attempts: 1, channel: "wa" },
      { dedupe_key: staffAlertDedupeKey("done", "faizal"), status: "delivered", attempts: 1, channel: "wa" },
      { dedupe_key: "new_booking:read:titik", status: "read", attempts: 1, channel: "wa" },
      { dedupe_key: staffAlertDedupeKey("book-1", "off"), status: "pending", attempts: 0, channel: "wa" },
    ],
  });
  const keys = targets.map((row) => `${row.reason}:${row.bookingId}:${row.managerId}`).sort();
  assert.deepEqual(keys, [
    "missing:book-1:titik",
    "missing:done:off",
    "pending_zero:book-1:faizal",
  ].filter((key) => !key.includes(":off")).sort());
  assert.equal(targets.some((row) => row.managerId === "titik"), true);
  assert.equal(targets.some((row) => row.managerId === "off"), false);
  assert.equal(targets.some((row) => row.managerId === "nophone"), false);
  assert.equal(targets.some((row) => row.bookingId === "cancelled" || row.bookingId === "too-new" || row.bookingId === "too-old"), false);
  assert.equal(targets.some((row) => row.bookingId === "done"), false);
}

{
  const now = Date.parse("2026-10-10T12:00:00.000Z");
  const skipped = selectStaffAlertRecoveryTargets({
    now,
    managers: [{ id: "titik", phone: "628111", is_active: true, is_muted: true }],
    bookings: [{ id: "b", status: "confirmed", created_at: new Date(now - 60 * 60 * 1000).toISOString() }],
    logs: [
      { dedupe_key: "new_booking:b:titik", status: "read", attempts: 1, channel: "wa" },
      { dedupe_key: "new_booking:other:titik", status: "failed", attempts: 3, channel: "wa" },
      { dedupe_key: "new_booking:mid:titik", status: "pending", attempts: 2, channel: "wa" },
    ],
  });
  assert.deepEqual(skipped, []);
  assert.equal(
    isCutOffPendingLog(
      { status: "pending", attempts: 0, created_at: new Date(now - STAFF_ALERT_RECOVERY_MIN_AGE_MS).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    isCutOffPendingLog({ status: "pending", attempts: 0, created_at: new Date(now - 30_000).toISOString() }, now),
    false,
  );
}

assert.equal(findReengagementCode([{ code: 131047, title: "Re-engagement message" }]), 131047);
assert.equal(findReengagementCode("error 131026"), 131026);
assert.equal(findReengagementCode([{ code: 470 }]), 470);

{
  const failed = decideNotificationLogStatusUpdate(
    { status: "sent" },
    { status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
  );
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /131047/);
  assert.match(failed?.error ?? "", /24 jam/);
  assert.equal(decideNotificationLogStatusUpdate({ status: "sent" }, { status: "delivered" })?.status, "delivered");
  assert.equal(decideNotificationLogStatusUpdate({ status: "delivered" }, { status: "read" })?.status, "read");
  assert.equal(decideNotificationLogStatusUpdate({ status: "read" }, { status: "delivered" }), null);
  assert.equal(decideNotificationLogStatusUpdate({ status: "read" }, { status: "sent" }), null);
  const other = decideNotificationLogStatusUpdate({ status: "sent" }, { status: "failed", errors: [{ title: "Media" }] });
  assert.equal(other?.status, "failed");
  assert.match(other?.error ?? "", /Media/);
}

{
  const logs = [
    { id: "log-1", status: "sent", event_type: "new_booking", provider_message_id: "wamid.abc" },
    { id: "log-2", status: "sent", event_type: "new_booking", provider_message_id: "wamid.other" },
  ];
  const db = {
    from() {
      return {
        select() {
          return {
            eq(_col: string, value: string) {
              return Promise.resolve({
                data: logs.filter((row) => row.provider_message_id === value),
                error: null,
              });
            },
          };
        },
        update(patch: { status: string; error: string | null }) {
          return {
            eq(_col: string, id: string) {
              const row = logs.find((item) => item.id === id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  const updated = await applyNotificationLogDeliveryStatus(db, {
    wamid: "wamid.abc",
    status: "failed",
    errors: [{ code: 131047, message: "Re-engagement message" }],
  });
  assert.equal(updated.updated, 1);
  assert.equal(logs[0].status, "failed");
  assert.match(String((logs[0] as { error?: string }).error), /131047/);
  assert.equal(logs[1].status, "sent");
  const miss = await applyNotificationLogDeliveryStatus(db, { wamid: "wamid.missing", status: "delivered" });
  assert.equal(miss.updated, 0);
  await applyNotificationLogDeliveryStatus(db, { wamid: "wamid.other", status: "read" });
  assert.equal(logs[1].status, "read");
  await applyNotificationLogDeliveryStatus(db, { wamid: "wamid.other", status: "delivered" });
  assert.equal(logs[1].status, "read");
}

function makeLogDb(seed: Array<Record<string, unknown>>) {
  const logs = seed.map((row) => ({ ...row }));
  return {
    logs,
    from(table: string) {
      assert.equal(table, "notification_logs");
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          const row = logs.find((item) => Object.entries(filters).every(([key, value]) => item[key] === value));
          return { data: row ?? null, error: null };
        },
        insert(row: Record<string, unknown>) {
          const stored = { id: `new-${logs.length + 1}`, attempts: 0, ...row };
          logs.push(stored);
          return { select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }) };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              const row = logs.find((item) => item.id === id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return builder;
    },
  };
}

{
  const now = Date.now();
  const db = makeLogDb([
    {
      id: "cut",
      status: "pending",
      attempts: 0,
      created_at: new Date(now - STAFF_ALERT_RECOVERY_MIN_AGE_MS - 1000).toISOString(),
      dedupe_key: "new_booking:b:m",
      channel: "wa",
    },
  ]);
  const sent = await sendWithRetry(
    db as never,
    null,
    {
      eventType: "new_booking",
      recipient: { id: "m", name: "Bu Titik", phone: "628111", role: "booking_manager" },
      message: "alert",
      dedupeKey: "new_booking:b:m",
      channel: "wa",
    },
    async () => ({ ok: true, messageId: "wamid.staff" }),
  );
  assert.equal(sent, true);
  assert.equal(db.logs[0].status, "sent");
  assert.equal(db.logs[0].provider_message_id, "wamid.staff");
  assert.equal(db.logs.length, 1);
}

{
  const db = makeLogDb([
    {
      id: "fresh",
      status: "pending",
      attempts: 0,
      created_at: new Date().toISOString(),
      dedupe_key: "new_booking:b:m",
      channel: "wa",
    },
  ]);
  let calls = 0;
  const sent = await sendWithRetry(
    db as never,
    null,
    {
      eventType: "new_booking",
      recipient: { id: "m", name: "Pak Faizal", phone: "628222", role: "super_admin" },
      message: "alert",
      dedupeKey: "new_booking:b:m",
      channel: "wa",
    },
    async () => {
      calls += 1;
      return { ok: true, messageId: "wamid.nope" };
    },
  );
  assert.equal(sent, false);
  assert.equal(calls, 0);
  assert.equal(db.logs[0].status, "pending");
}

{
  const db = makeLogDb([]);
  const sent = await sendWithRetry(
    db as never,
    null,
    {
      eventType: "new_booking",
      recipient: { id: "m", name: "Bu Titik", phone: "628111", role: "booking_manager" },
      message: "alert",
      dedupeKey: "new_booking:fresh:m",
      channel: "wa",
    },
    async () => ({ ok: true }),
  );
  assert.equal(sent, false);
  assert.equal(db.logs[0].status, "failed");
  assert.match(String(db.logs[0].error), /id pesan/);
  assert.equal(db.logs[0].provider_message_id, undefined);
}

{
  const db = makeLogDb([
    {
      id: "delivered",
      status: "delivered",
      attempts: 1,
      created_at: new Date().toISOString(),
      dedupe_key: "new_booking:b:m",
      channel: "wa",
    },
  ]);
  let calls = 0;
  const sent = await sendWithRetry(
    db as never,
    null,
    {
      eventType: "new_booking",
      recipient: { id: "m", name: "Bu Titik", phone: "628111", role: "booking_manager" },
      message: "alert",
      dedupeKey: "new_booking:b:m",
      channel: "wa",
    },
    async () => {
      calls += 1;
      return { ok: true, messageId: "wamid.again" };
    },
  );
  assert.equal(sent, false);
  assert.equal(calls, 0);
  assert.equal(db.logs[0].status, "delivered");
}

{
  const started = Date.now();
  await awaitNotifyNewBooking({} as never, "01234567-booking", {
    timeoutMs: 40,
    notify: () => new Promise((resolve) => setTimeout(resolve, 400)),
  });
  assert.ok(Date.now() - started < 300);
  await awaitNotifyNewBooking({} as never, "01234567-booking", {
    timeoutMs: 50,
    notify: async () => {
      throw new Error("gateway down");
    },
  });
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const bookings = read("../src/admin/functions/bookings.functions.ts");
const calendar = read("../src/admin/functions/calendar.functions.ts");
const website = read("../src/public/functions/public.functions.ts");
const bot = read("../src/tools/booking.tool.ts");
assert.match(bookings, /await awaitNotifyNewBooking\(context\.supabase, booking\.id\)/);
assert.doesNotMatch(bookings, /createMultiRoomBooking\.notifyNewBooking/);
assert.match(calendar, /await awaitNotifyNewBooking\(supabase, bookingId\)/);
assert.doesNotMatch(calendar, /createBookingFromAdmin\.notifyNewBooking/);
assert.match(website, /await awaitNotifyNewBooking\(supabaseAdmin, booking\.id\)/);
assert.match(website, /await awaitCartStaffAlert\(supabaseAdmin, booking\.id\)/);
assert.doesNotMatch(website, /submitPublicBooking\.notifyNewBooking|submitCartBooking\.notifyNewBooking/);
assert.match(bot, /await awaitNotifyNewBooking\(ctx\.supabaseAdmin/);
assert.doesNotMatch(bot, /waitUntil\(notifyManager/);

const notifier = read("../src/services/manager-notifier.service.ts");
assert.match(notifier, /TODO: Jangan mulai menghormati property_managers\.is_muted/);
assert.match(notifier, /provider_message_id: wamid/);
assert.doesNotMatch(notifier, /\.eq\(\s*["']is_muted["']\s*,/);

const inbox = read("../src/services/whatsapp-meta-inbox.service.ts");
assert.match(inbox, /applyNotificationLogDeliveryStatus/);

const cron = read("../src/routes/api.cron.recover-staff-booking-alerts.ts");
assert.match(cron, /recoverStaffBookingAlerts/);
assert.match(cron, /\/api\/cron\/recover-staff-booking-alerts/);

const sql = read("../supabase/migrations/20261010160000_cron_recover_staff_booking_alerts.sql");
assert.match(sql, /cron\.schedule\(\s*'recover-staff-booking-alerts'/);
assert.match(sql, /https:\/\/pomahguesthouse\.com/);
assert.match(sql, /\/api\/cron\/recover-staff-booking-alerts/);
assert.match(sql, /timeout_milliseconds := 30000/);
assert.match(sql, /provider_message_id/);
assert.match(sql, /'delivered'/);
assert.match(sql, /'read'/);

const routeTree = read("../src/routeTree.gen.ts");
assert.match(routeTree, /api\.cron\.recover-staff-booking-alerts/);
assert.match(routeTree, /\/api\/cron\/recover-staff-booking-alerts/);

const pkg = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
assert.match(pkg.scripts["test:wa-refactor"], /test:staff-booking-alert/);

restoreDelays();
console.log("staff booking alert tests passed");
