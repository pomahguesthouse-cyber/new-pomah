/**
 * Regresi thread tamu 10 Okt 2026 (6287773522112, booking PG-Y3E3N).
 *
 * 1. Satu tanggal ("21 nov") = kandidat check-in. Lookup 1 malam boleh.
 *    Ringkasan/booking menunggu "Check-in 21 Nov, check-out 22 Nov (1 malam) ya Kak?".
 * 2. Koreksi check-in+check-out menulis draft dan cek ulang ketersediaan.
 *    20–21 penuh → tidak ada ringkasan yang bisa dikunci, "oke" tidak insert.
 * 3. Hanya check-out, hanya check-in (jangan diam-diam jadi 20–22).
 * 4. create_booking menolak bila draft ≠ ringkasan terakhir.
 * 5. Setelah booking ada, bot tidak mengklaim tanggal sudah diubah; staf diberitahu.
 * 6. "2x 2x Deluxe" dan jumlah tamu 4 yang jatuh jadi 2.
 *
 * Tidak menyentuh database produksi.
 */
import assert from "node:assert/strict";
import { resolveRelativeDayRange } from "../src/lib/id-date";
import { parseAvailabilityDateRange, resolveDisplayedGuests } from "../src/services/wa-autoreply/message-parsers";
import { protectStatedGuestCount } from "../src/lib/guest-count";
import { resolveStartBookingGuests } from "../src/tools/start-booking.tool";
import { staySnapshotsMatch, snapshotFromStay } from "../src/ai/state-machine/booking-stay-guard";
import {
  formatRoomsDisplay,
  formatStayConfirmQuestion,
  planStayCorrection,
} from "../src/ai/state-machine/booking-stay-guard";
import {
  processBookingState,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";

const TODAY = "2026-10-10";
const WA = "6287773522112";
const DELUXE = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: 230000,
  capacity: 2,
  extrabed_capacity: 1,
  extrabed_rate: 80000,
};
const FAMILY = {
  id: "rt-family",
  name: "Family",
  base_rate: 400000,
  capacity: 4,
  extrabed_capacity: 0,
  extrabed_rate: 0,
};

type AvailRow = { room_type_id: string; available: number };

function makeDb(soldOut: (checkIn: string, checkOut: string) => AvailRow[]) {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    pushes: [] as Array<Record<string, unknown>>,
    availability: [] as Array<{ checkIn: string; checkOut: string }>,
  };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt", "not", "or"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "row-1" }, error: null });
    b.insert = (row: Record<string, unknown>) => {
      rec.inserts.push({ table, row });
      return b;
    };
    b.update = () => b;
    b.upsert = async () => ({ error: null });
    b.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: any) => {
      if (name === "update_booking_state") {
        rec.states.push({ state: args.p_state, context: JSON.parse(JSON.stringify(args.p_context)) });
        return { data: null, error: null };
      }
      if (name === "room_type_availability_detail") {
        rec.availability.push({ checkIn: args.p_check_in, checkOut: args.p_check_out });
        return { data: soldOut(args.p_check_in, args.p_check_out), error: null };
      }
      if (name === "enqueue_staff_push") {
        rec.pushes.push(args?.p_payload ?? args);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db, rec };
}

function openInventory(checkIn: string, checkOut: string): AvailRow[] {
  if (checkIn === "2026-11-20" && checkOut === "2026-11-21") {
    return [
      { room_type_id: DELUXE.id, available: 0 },
      { room_type_id: FAMILY.id, available: 2 },
    ];
  }
  return [
    { room_type_id: DELUXE.id, available: 4 },
    { room_type_id: FAMILY.id, available: 2 },
  ];
}

function allOpen(): AvailRow[] {
  return [
    { room_type_id: DELUXE.id, available: 4 },
    { room_type_id: FAMILY.id, available: 2 },
  ];
}

function ctxOf(db: any) {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms: [DELUXE, FAMILY],
    property: { id: "prop-1", payment_bank_name: "BCA", payment_account_number: "123", payment_account_holder: "Pomah" },
    today: TODAY,
    phone: WA,
  };
}

function record(state: StateRecord["state"], context: BookingContext): StateRecord {
  return { phone: WA, state, context, updated_at: "2026-10-10T07:45:00.000Z", slots: {} };
}

function draft(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: "2026-11-21",
    checkOut: "2026-11-22",
    roomId: DELUXE.id,
    roomName: "2x Deluxe",
    pricePerNight: 230000,
    totalPrice: 460000,
    quotedTotal: 460000,
    guestName: "Tamu Nov",
    guestPhone: WA,
    adults: 4,
    children: 0,
    datesConfirmed: true,
    rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "2x Deluxe", quantity: 2, pricePerNight: 230000 }],
    lastSummary: {
      checkIn: "2026-11-21",
      checkOut: "2026-11-22",
      rooms: [{ roomTypeId: DELUXE.id, quantity: 2 }],
      adults: 4,
      children: 0,
      total: 460000,
    },
    ...over,
  };
}

function writes(calls: Array<Record<string, unknown>>) {
  return calls.map((args) => ({
    check_in: args.check_in,
    check_out: args.check_out,
    adults: args.adults,
    summary: args.expected_summary,
  }));
}

// ── Parser: satu tanggal vs koreksi ─────────────────────────────────────────
{
  const stay = resolveRelativeDayRange("boleh tanya untuk tanggal 21 nov masih ada kamar kosong ga ya?", `${TODAY}T14:33:00+07:00`);
  assert.ok(stay);
  assert.equal(stay!.checkIn, "2026-11-21");
  assert.equal(stay!.checkOut, "2026-11-22");
  assert.equal(stay!.checkoutAssumed, true);
  assert.equal(stay!.needsConfirm, undefined);
  const lookup = parseAvailabilityDateRange("21 nov masih ada kamar?", TODAY);
  assert.deepEqual(
    lookup && { checkIn: lookup.checkIn, checkOut: lookup.checkOut },
    { checkIn: "2026-11-21", checkOut: "2026-11-22" },
  );
  assert.equal(
    formatStayConfirmQuestion("2026-11-21", "2026-11-22"),
    "Check-in 21 Nov, check-out 22 Nov (1 malam) ya Kak?",
  );
}

{
  const both = planStayCorrection(
    "ralat kak untuk check in 20 November dan check out 21 November",
    { checkIn: "2026-11-21", checkOut: "2026-11-22" },
    TODAY,
  );
  assert.deepEqual(
    both && { checkIn: both.checkIn, checkOut: both.checkOut, needsConfirm: both.needsConfirm },
    { checkIn: "2026-11-20", checkOut: "2026-11-21", needsConfirm: false },
  );
}

{
  const onlyIn = planStayCorrection(
    "maaf maksudnya check-in 20",
    { checkIn: "2026-11-21", checkOut: "2026-11-22" },
    TODAY,
  );
  assert.ok(onlyIn);
  assert.equal(onlyIn!.checkIn, "2026-11-20");
  assert.equal(onlyIn!.checkOut, "2026-11-21", "jangan gabung jadi 20–22");
  assert.equal(onlyIn!.wouldLengthen, true);
  assert.equal(onlyIn!.needsConfirm, true);
}

{
  const onlyOut = planStayCorrection(
    "ralat check out 22 bukan 23",
    { checkIn: "2026-11-21", checkOut: "2026-11-23" },
    TODAY,
  );
  assert.deepEqual(
    onlyOut && { checkIn: onlyOut.checkIn, checkOut: onlyOut.checkOut, needsConfirm: onlyOut.needsConfirm },
    { checkIn: "2026-11-21", checkOut: "2026-11-22", needsConfirm: false },
  );
}

assert.equal(formatRoomsDisplay([{ quantity: 2, roomTypeName: "2x Deluxe" }], "2x 2x Deluxe"), "2x Deluxe");
assert.equal(
  resolveStartBookingGuests({ adults: 2, children: 0 }, { partialAdults: 4, partialChildren: 0 }, [DELUXE]).adults,
  4,
);
assert.deepEqual(
  protectStatedGuestCount({ adults: 2, children: 0 }, { adults: 4, children: 0 }, [DELUXE]),
  { adults: 4, children: 0 },
);
assert.equal(resolveDisplayedGuests("2 kamar deluxe", { partialAdults: 4, partialChildren: 0 })?.total, 4);

// ── (a) satu tanggal: tanya dulu, baru ringkasan, baru booking ──────────────
{
  const { db, rec } = makeDb(allOpen);
  const calls: Array<Record<string, unknown>> = [];
  const impl = async (args: Record<string, unknown>) => {
    calls.push(args);
    return JSON.stringify({ ok: true, reference_code: "PG-TEST" });
  };
  const asked = await processBookingState(
    ctxOf(db),
    WA,
    "boleh tanya untuk tanggal 21 nov masih ada kamar kosong ga ya?",
    record("CONFIRMING_BOOKING", draft({ checkoutAssumed: true, datesConfirmed: false, lastSummary: undefined })),
    { createBookingImpl: impl as any },
  );
  assert.match(asked.reply ?? "", /Check-in 21 Nov, check-out 22 Nov \(1 malam\) ya Kak\?/);
  assert.equal(calls.length, 0);

  const summary = await processBookingState(
    ctxOf(db),
    WA,
    "ya",
    record("CONFIRMING_BOOKING", rec.states.at(-1)!.context),
    { createBookingImpl: impl as any },
  );
  assert.match(summary.reply ?? "", /2x Deluxe/);
  assert.doesNotMatch(summary.reply ?? "", /2x 2x Deluxe/);
  assert.match(summary.reply ?? "", /4 orang dewasa/);
  assert.doesNotMatch(summary.reply ?? "", /dengan 2 tamu/);
  assert.equal(calls.length, 0, "konfirmasi 1 malam belum boleh insert");

  const booked = await processBookingState(
    ctxOf(db),
    WA,
    "ya",
    record("CONFIRMING_BOOKING", rec.states.at(-1)!.context),
    { createBookingImpl: impl as any },
  );
  assert.equal(booked.followUp, "send_invoice");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.check_in, "2026-11-21");
  assert.equal(calls[0]!.check_out, "2026-11-22");
  assert.equal(calls[0]!.adults, 4);
}

// ── satu tanggal yang dikoreksi tanpa label check-in: draft ikut berubah ───
{
  const { db, rec } = makeDb(allOpen);
  const calls: Array<Record<string, unknown>> = [];
  const reply = await processBookingState(
    ctxOf(db),
    WA,
    "ralat tanggal 20 november",
    record("CONFIRMING_BOOKING", draft({ checkoutAssumed: true, datesConfirmed: false, lastSummary: undefined })),
    {
      createBookingImpl: (async (args: Record<string, unknown>) => {
        calls.push(args);
        return JSON.stringify({ ok: true, reference_code: "PG-X" });
      }) as any,
    },
  );
  assert.equal(rec.states.at(-1)!.context.checkIn, "2026-11-20");
  assert.equal(rec.states.at(-1)!.context.checkOut, "2026-11-21");
  assert.equal(rec.states.at(-1)!.context.checkoutAssumed, true);
  assert.match(reply.reply ?? "", /Check-in 20 Nov, check-out 21 Nov \(1 malam\) ya Kak\?/);
  assert.equal(calls.length, 0);
}

// ── (b)(c)(d) koreksi 20–21 penuh: state berubah, tidak insert tanggal lama ─
{
  const { db, rec } = makeDb(openInventory);
  const calls: Array<Record<string, unknown>> = [];
  const impl = async (args: Record<string, unknown>) => {
    calls.push(args);
    return JSON.stringify({ ok: true, reference_code: "PG-Y3E3N" });
  };
  const corrected = await processBookingState(
    ctxOf(db),
    WA,
    "ralat kak untuk check in 20 November dan check out 21 November",
    record("CONFIRMING_BOOKING", draft()),
    { createBookingImpl: impl as any },
  );
  const saved = rec.states.at(-1)!;
  assert.equal(saved.context.checkIn, "2026-11-20");
  assert.equal(saved.context.checkOut, "2026-11-21");
  assert.equal(saved.context.availabilityBlocked, true);
  assert.equal(saved.context.lastSummary, undefined);
  assert.match(corrected.reply ?? "", /penuh/i);
  assert.match(corrected.reply ?? "", /Family/);
  assert.doesNotMatch(corrected.reply ?? "", /Total:/);
  assert.ok(
    rec.availability.some((row) => row.checkIn === "2026-11-20" && row.checkOut === "2026-11-21"),
    "ketersediaan 20–21 harus dicek ulang",
  );

  const agreed = await processBookingState(
    ctxOf(db),
    WA,
    "oke kak sudah benar",
    record("CONFIRMING_BOOKING", saved.context),
    { createBookingImpl: impl as any },
  );
  assert.equal(calls.length, 0, "jangan insert 21–22 dari state lama");
  assert.match(agreed.reply ?? "", /belum saya catat|belum tersedia/i);
  assert.equal(saved.context.adults, 4);
}

// ── hanya check-in: tanya 20–21, bukan 20–22 ────────────────────────────────
{
  const { db, rec } = makeDb(allOpen);
  const calls: Array<Record<string, unknown>> = [];
  const reply = await processBookingState(
    ctxOf(db),
    WA,
    "maaf maksudnya check-in 20",
    record("CONFIRMING_BOOKING", draft()),
    {
      createBookingImpl: (async (args: Record<string, unknown>) => {
        calls.push(args);
        return JSON.stringify({ ok: true, reference_code: "PG-X" });
      }) as any,
    },
  );
  assert.equal(rec.states.at(-1)!.context.checkIn, "2026-11-20");
  assert.equal(rec.states.at(-1)!.context.checkOut, "2026-11-21");
  assert.match(reply.reply ?? "", /Check-in 20 Nov, check-out 21 Nov \(1 malam\) ya Kak\?/);
  assert.doesNotMatch(reply.reply ?? "", /22 Nov/);
  assert.equal(calls.length, 0);
}

// ── hanya check-out ─────────────────────────────────────────────────────────
{
  const { db, rec } = makeDb(allOpen);
  const reply = await processBookingState(
    ctxOf(db),
    WA,
    "ralat check out 22 bukan 23",
    record(
      "CONFIRMING_BOOKING",
      draft({
        checkIn: "2026-11-21",
        checkOut: "2026-11-23",
        totalPrice: 920000,
        quotedTotal: 920000,
        lastSummary: {
          checkIn: "2026-11-21",
          checkOut: "2026-11-23",
          rooms: [{ roomTypeId: DELUXE.id, quantity: 2 }],
          adults: 4,
          children: 0,
          total: 920000,
        },
      }),
    ),
    { createBookingImpl: (async () => JSON.stringify({ ok: true, reference_code: "PG-X" })) as any },
  );
  assert.equal(rec.states.at(-1)!.context.checkIn, "2026-11-21");
  assert.equal(rec.states.at(-1)!.context.checkOut, "2026-11-22");
  assert.match(reply.reply ?? "", /22 November 2026/);
  assert.match(reply.reply ?? "", /2x Deluxe/);
  assert.doesNotMatch(reply.reply ?? "", /2x 2x/);
  assert.match(reply.reply ?? "", /4 orang dewasa/);
  assert.equal(rec.states.at(-1)!.context.lastSummary?.checkOut, "2026-11-22");
}

// ── ringkasan terakhir tidak sama dengan draft → jangan insert ──────────────
{
  const shown = snapshotFromStay({
    checkIn: "2026-11-20",
    checkOut: "2026-11-21",
    rooms: [{ roomTypeId: DELUXE.id, quantity: 2 }],
    adults: 4,
    children: 0,
    total: 460000,
  })!;
  const latest = snapshotFromStay({
    checkIn: "2026-11-21",
    checkOut: "2026-11-22",
    rooms: [{ roomTypeId: DELUXE.id, quantity: 2 }],
    adults: 4,
    children: 0,
    total: 460000,
  })!;
  assert.equal(staySnapshotsMatch(shown, latest), false);

  const { db } = makeDb(allOpen);
  const calls: Array<Record<string, unknown>> = [];
  const reply = await processBookingState(
    ctxOf(db),
    WA,
    "ya",
    record("CONFIRMING_BOOKING", draft({ lastSummary: shown })),
    {
      createBookingImpl: (async (args: Record<string, unknown>) => {
        calls.push(args);
        return JSON.stringify({ ok: true, reference_code: "PG-X" });
      }) as any,
    },
  );
  assert.equal(calls.length, 0);
  assert.match(reply.reply ?? "", /21 November 2026/);
  assert.match(reply.reply ?? "", /22 November 2026/);
  assert.equal(writes(calls).length, 0);
}

// ── setelah booking tercatat: jangan mengarang update ───────────────────────
{
  const { db, rec } = makeDb(allOpen);
  const calls: Array<Record<string, unknown>> = [];
  const reply = await processBookingState(
    ctxOf(db),
    WA,
    "invoice salah kak, check-in 20",
    record(
      "PAYMENT_PENDING",
      draft({ bookingCode: "PG-Y3E3N" }),
    ),
    {
      createBookingImpl: (async (args: Record<string, unknown>) => {
        calls.push(args);
        return JSON.stringify({ ok: true, reference_code: "PG-Y3E3N" });
      }) as any,
    },
  );
  assert.match(reply.reply ?? "", /belum saya ubah/);
  assert.match(reply.reply ?? "", /staf/i);
  assert.match(reply.reply ?? "", /PG-Y3E3N/);
  assert.doesNotMatch(reply.reply ?? "", /sudah perbarui|sudah saya ubah|sudah saya ganti/i);
  assert.equal(calls.length, 0);
  assert.equal(rec.states.filter((row) => row.context.checkIn !== "2026-11-21").length, 0);
  const logged = rec.inserts.some(
    (row) => row.table === "notification_logs" && String(row.row.message ?? "").includes("PG-Y3E3N"),
  );
  const pushed = rec.pushes.some((row) => String(row.title ?? "").includes("PG-Y3E3N"));
  assert.ok(logged || pushed, "staf harus diberitahu kode booking dan permintaan ubah");
}

console.log("✓ booking date-correction regressions passed");
