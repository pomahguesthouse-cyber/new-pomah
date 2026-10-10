/**
 * Invoice WhatsApp pada booking admin/website.
 *
 *  - pengiriman ditunggu di request, dengan batas waktu, dan tidak melempar
 *  - status: sent / failed + alasan / skipped
 *  - dedupe sekali-per-booking tetap (klaim yang kalah → skipped, bukan kirim ulang)
 *  - pemulihan hanya booking non-batal, 5 menit–24 jam, ada nomor, tanpa baris invoices
 *  - pemulihan tidak memakai force
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INVOICE_DISPATCH_TIMEOUT_MS,
  INVOICE_TIMEOUT_REASON,
  awaitInvoiceNotification,
  classifyInvoiceResult,
} from "../src/services/invoice-dispatch";
import {
  INVOICE_RECOVERY_BATCH_LIMIT,
  INVOICE_RECOVERY_LOOKBACK_MS,
  INVOICE_RECOVERY_MIN_AGE_MS,
  guestPhoneOf,
  hasInvoiceRecord,
  recoverMissingInvoices,
  selectRecoverableBookings,
  type MissingInvoiceRow,
} from "../src/services/invoice-recovery.service";
import {
  INVOICE_RESEND_ACTION_LABEL,
  planBookingInvoiceToast,
} from "../src/lib/invoice-toast-plan";
import type { InvoiceResult } from "../src/services/invoice-notification.service";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function result(partial: Partial<InvoiceResult> & Pick<InvoiceResult, "ok" | "wa_sent">): InvoiceResult {
  return { error: null, pdf_url: null, ...partial };
}

function row(partial: Partial<MissingInvoiceRow> & Pick<MissingInvoiceRow, "id" | "created_at">): MissingInvoiceRow {
  return {
    status: "pending",
    guests: { phone: "081234567890" },
    invoices: null,
    ...partial,
  };
}

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

const sent = classifyInvoiceResult(result({ ok: true, wa_sent: true, pdf_url: "https://example/inv" }));
assert.deepEqual(sent, { status: "sent" });

const deduped = classifyInvoiceResult(result({ ok: true, wa_sent: false, pdf_url: "https://example/inv" }));
assert.equal(deduped.status, "skipped");
assert.match(deduped.status === "skipped" ? deduped.reason : "", /sudah pernah dikirim/);

const noPhone = classifyInvoiceResult(
  result({ ok: false, wa_sent: false, error: "Guest has no phone number, cannot send notification" }),
);
assert.equal(noPhone.status, "skipped");
assert.match(noPhone.status === "skipped" ? noPhone.reason : "", /tidak punya nomor/);

const badPhone = classifyInvoiceResult(
  result({ ok: false, wa_sent: false, error: "Nomor tidak valid: abc" }),
);
assert.equal(badPhone.status, "skipped");

const gatewayDown = classifyInvoiceResult(
  result({ ok: false, wa_sent: false, error: "HTTP 500: gateway down" }),
);
assert.deepEqual(gatewayDown, { status: "failed", reason: "HTTP 500: gateway down" });

const channel = classifyInvoiceResult(
  result({
    ok: false,
    wa_sent: false,
    error: "WhatsApp tamu belum terkonfigurasi. WhatsApp Business (Meta) belum terhubung.",
  }),
);
assert.equal(channel.status, "failed");

{
  const outcome = await awaitInvoiceNotification(
    { supabase: {} as never, bookingId: "11111111-1111-1111-1111-111111111111" },
    {
      timeoutMs: 200,
      send: async () => result({ ok: true, wa_sent: true }),
    },
  );
  assert.deepEqual(outcome, { status: "sent" });
}

{
  const outcome = await awaitInvoiceNotification(
    { supabase: {} as never, bookingId: "22222222-2222-2222-2222-222222222222" },
    {
      timeoutMs: 200,
      send: async () => {
        throw new Error("socket hang up");
      },
    },
  );
  assert.deepEqual(outcome, { status: "failed", reason: "socket hang up" });
}

{
  const outcome = await awaitInvoiceNotification(
    { supabase: {} as never, bookingId: "33333333-3333-3333-3333-333333333333" },
    {
      timeoutMs: 30,
      send: () => new Promise<InvoiceResult>(() => {}),
    },
  );
  assert.deepEqual(outcome, { status: "failed", reason: INVOICE_TIMEOUT_REASON });
}

{
  const outcome = await awaitInvoiceNotification(
    { supabase: {} as never, bookingId: "44444444-4444-4444-4444-444444444444" },
    {
      timeoutMs: 300,
      send: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(result({ ok: true, wa_sent: true })), 40);
        }),
    },
  );
  assert.equal(outcome.status, "sent");
}

assert.equal(INVOICE_DISPATCH_TIMEOUT_MS, 9_000);
assert.ok(INVOICE_DISPATCH_TIMEOUT_MS >= 8_000 && INVOICE_DISPATCH_TIMEOUT_MS <= 10_000);

const minute = 60_000;
const eligible = row({ id: "ok", created_at: iso(10 * minute) });
const tooNew = row({ id: "new", created_at: iso(2 * minute) });
const tooOld = row({ id: "old", created_at: iso(25 * 60 * minute) });
const cancelled = row({ id: "cancel", status: "cancelled", created_at: iso(10 * minute) });
const expired = row({ id: "expired", status: "expired", created_at: iso(10 * minute) });
const noGuestPhone = row({ id: "nophone", created_at: iso(10 * minute), guests: { phone: "  " } });
const nullGuest = row({ id: "nullguest", created_at: iso(10 * minute), guests: null });
const withInvoice = row({ id: "has", created_at: iso(10 * minute), invoices: { id: "inv-1" } });
const withInvoiceList = row({
  id: "has-list",
  created_at: iso(10 * minute),
  invoices: [{ id: "inv-2" }],
});
const emptyInvoiceList = row({ id: "empty-list", created_at: iso(10 * minute), invoices: [] });

assert.equal(guestPhoneOf(eligible), "081234567890");
assert.equal(guestPhoneOf(noGuestPhone), null);
assert.equal(hasInvoiceRecord(withInvoice), true);
assert.equal(hasInvoiceRecord(withInvoiceList), true);
assert.equal(hasInvoiceRecord(emptyInvoiceList), false);
assert.equal(hasInvoiceRecord(eligible), false);

const picked = selectRecoverableBookings(
  [eligible, tooNew, tooOld, cancelled, expired, noGuestPhone, nullGuest, withInvoice, withInvoiceList, emptyInvoiceList],
  NOW,
);
assert.deepEqual(
  picked.map((item) => item.id).sort(),
  ["empty-list", "expired", "ok"],
);

assert.equal(INVOICE_RECOVERY_MIN_AGE_MS, 5 * minute);
assert.equal(INVOICE_RECOVERY_LOOKBACK_MS, 24 * 60 * minute);
assert.equal(INVOICE_RECOVERY_BATCH_LIMIT, 3);

function fakeDb(rows: MissingInvoiceRow[]) {
  const sends: Array<{ bookingId: string; force?: boolean; skipWhatsApp?: boolean }> = [];
  const db = {
    from(table: string) {
      assert.equal(table, "bookings");
      const filters: Array<(row: MissingInvoiceRow) => boolean> = [];
      let lim = Infinity;
      let sortAsc = true;
      const b: Record<string, unknown> = {
        select: () => b,
        neq(col: string, val: unknown) {
          filters.push((item) => (item as unknown as Record<string, unknown>)[col] !== val);
          return b;
        },
        gte(col: string, val: string) {
          filters.push((item) => String((item as unknown as Record<string, unknown>)[col]) >= val);
          return b;
        },
        lte(col: string, val: string) {
          filters.push((item) => String((item as unknown as Record<string, unknown>)[col]) <= val);
          return b;
        },
        order(_col: string, opts: { ascending: boolean }) {
          sortAsc = opts.ascending;
          return b;
        },
        limit(n: number) {
          lim = n;
          return b;
        },
        then(resolve: (value: { data: MissingInvoiceRow[]; error: null }) => void) {
          let out = rows.filter((item) => filters.every((fn) => fn(item)));
          out = [...out].sort((a, b) =>
            sortAsc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
          );
          resolve({ data: out.slice(0, lim), error: null });
        },
      };
      return b;
    },
  };
  return { db, sends };
}

{
  const { db, sends } = fakeDb([
    row({ id: "old-first", created_at: iso(30 * minute) }),
    row({ id: "mid", created_at: iso(20 * minute) }),
    row({ id: "newer", created_at: iso(12 * minute) }),
    row({ id: "newest", created_at: iso(8 * minute) }),
    tooNew,
    cancelled,
    withInvoice,
    noGuestPhone,
  ]);
  const summary = await recoverMissingInvoices(db as never, {
    now: () => NOW,
    limit: 2,
    send: async (input) => {
      sends.push({
        bookingId: input.bookingId,
        force: input.force,
        skipWhatsApp: input.skipWhatsApp,
      });
      if (input.bookingId === "old-first") throw new Error("meta down");
      return result({ ok: true, wa_sent: true });
    },
  });
  assert.deepEqual(
    sends.map((item) => item.bookingId),
    ["old-first", "mid"],
  );
  assert.equal(sends.every((item) => item.force === false), true);
  assert.equal(sends.every((item) => item.skipWhatsApp === false), true);
  assert.equal(summary.ok, true);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.eligible, 2);
}

{
  const { db, sends } = fakeDb([eligible]);
  const summary = await recoverMissingInvoices(db as never, {
    now: () => NOW,
    send: async () => result({ ok: true, wa_sent: false }),
  });
  assert.equal(summary.skipped, 1);
  assert.equal(summary.sent, 0);
  assert.equal(sends.length, 0);
}

{
  const failing = {
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        neq: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        then(resolve: (value: { data: null; error: { message: string } }) => void) {
          resolve({ data: null, error: { message: "permission denied" } });
        },
      };
      return b;
    },
  };
  let called = false;
  const summary = await recoverMissingInvoices(failing as never, {
    now: () => NOW,
    send: async () => {
      called = true;
      return result({ ok: true, wa_sent: true });
    },
  });
  assert.equal(summary.ok, false);
  assert.equal(summary.error, "permission denied");
  assert.equal(called, false);
}

const sentPlan = planBookingInvoiceToast({ status: "sent" }, { canResend: true });
assert.deepEqual(sentPlan, { kind: "success", title: "Invoice terkirim ke WhatsApp tamu" });

const failedPlan = planBookingInvoiceToast(
  { status: "failed", reason: "HTTP 500: gateway down" },
  { canResend: true },
);
assert.equal(failedPlan?.kind, "warning");
assert.equal(failedPlan && failedPlan.kind === "warning" ? failedPlan.title : "", "HTTP 500: gateway down");
assert.equal(
  failedPlan && failedPlan.kind === "warning" ? failedPlan.actionLabel : null,
  INVOICE_RESEND_ACTION_LABEL,
);

const failedNoId = planBookingInvoiceToast({ status: "failed", reason: "gagal" }, { canResend: false });
assert.equal(failedNoId && failedNoId.kind === "warning" ? failedNoId.actionLabel : "x", null);

const skippedPlan = planBookingInvoiceToast({
  status: "skipped",
  reason: "Tamu tidak punya nomor WhatsApp, invoice tidak dikirim.",
});
assert.equal(skippedPlan?.kind, "info");
assert.equal(planBookingInvoiceToast(null), null);

function exportBody(src: string, name: string): string {
  const marker = `export const ${name}`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const next = src.indexOf("\nexport const ", start + marker.length);
  return src.slice(start, next === -1 ? undefined : next);
}

const bookingsSrc = readFileSync(new URL("../src/admin/functions/bookings.functions.ts", import.meta.url), "utf8");
const createMulti = exportBody(bookingsSrc, "createMultiRoomBooking");
assert.match(createMulti, /await awaitInvoiceNotification\(/);
assert.doesNotMatch(createMulti, /void generateAndSendInvoiceNotification/);
assert.match(createMulti, /grand_total: grandTotal, invoice/);
const updateFull = exportBody(bookingsSrc, "updateBookingFull");
assert.match(updateFull, /skipWhatsApp:\s*true/);
const resend = exportBody(bookingsSrc, "resendInvoice");
assert.match(resend, /force:\s*true/);

const calendarSrc = readFileSync(new URL("../src/admin/functions/calendar.functions.ts", import.meta.url), "utf8");
const createCal = exportBody(calendarSrc, "createBookingFromAdmin");
assert.match(createCal, /await awaitInvoiceNotification\(/);
assert.doesNotMatch(createCal, /void generateAndSendInvoiceNotification/);
assert.match(createCal, /invoice/);

const publicSrc = readFileSync(new URL("../src/public/functions/public.functions.ts", import.meta.url), "utf8");
for (const name of ["submitPublicBooking", "submitCartBooking"]) {
  const body = exportBody(publicSrc, name);
  assert.match(body, /await sendPublicBookingInvoice\(/, name);
  assert.doesNotMatch(body, /void import\(/, name);
  assert.match(body, /invoice,/, name);
}
assert.match(publicSrc, /await awaitInvoiceNotification\(/);
assert.doesNotMatch(publicSrc, /void generateAndSendInvoiceNotification/);

const dialogSrc = readFileSync(new URL("../src/admin/components/new-booking-dialog.tsx", import.meta.url), "utf8");
assert.match(dialogSrc, /toastBookingInvoice\(/);
assert.match(dialogSrc, /resendInvoice/);
assert.doesNotMatch(dialogSrc, /sedang dikirim/);

const calPage = readFileSync(new URL("../src/routes/admin/calendar.tsx", import.meta.url), "utf8");
assert.match(calPage, /toastBookingInvoice\(/);
assert.match(calPage, /resendFn\(\{ data: \{ bookingId: res\.bookingId \} \}\)/);
assert.match(calPage, /w-\[calc\(100vw-1rem\)\]/);

const toastSrc = readFileSync(new URL("../src/admin/lib/invoice-toast.ts", import.meta.url), "utf8");
assert.match(toastSrc, /Kirim Invoice/);
assert.match(toastSrc, /toast\.warning/);
assert.match(toastSrc, /toast\.success\("Invoice terkirim ke WhatsApp tamu"\)|plan\.title/);

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(css, /@media \(max-width: 420px\)/);
assert.match(css, /\[data-sonner-toast\]\[data-styled="true"\] \[data-button\]/);
assert.match(css, /width: 100%/);

const cron = readFileSync(
  new URL("../src/routes/api.cron.recover-missing-invoices.ts", import.meta.url),
  "utf8",
);
assert.match(cron, /recoverMissingInvoices/);
assert.match(cron, /\/api\/cron\/recover-missing-invoices/);

const sql = readFileSync(
  new URL("../supabase/migrations/20261010140000_cron_recover_missing_invoices.sql", import.meta.url),
  "utf8",
);
assert.match(sql, /cron\.schedule\(\s*'recover-missing-invoices'/);
assert.match(sql, /\/api\/cron\/recover-missing-invoices/);
assert.match(sql, /timeout_milliseconds := 30000/);
assert.doesNotMatch(sql, /force/);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};
assert.match(pkg.scripts["test:wa-refactor"], /test:invoice-dispatch/);

const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
assert.match(routeTree, /api\.cron\.recover-missing-invoices/);
assert.match(routeTree, /\/api\/cron\/recover-missing-invoices/);

console.log("invoice dispatch tests passed");
