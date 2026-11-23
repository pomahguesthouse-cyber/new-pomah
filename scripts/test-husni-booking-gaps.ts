/**
 * Regresi Husni Haris, 22 Nov 2026 17.24–17.34 WIB, booking PG-BSH8P.
 *
 * Tamu menempel template (hanya nama yang kosong) lalu menulis
 * "Sudah betul, bayar di lokasi nanti saat check in" dan "Sudah betul".
 * 1 Deluxe + 1 extra bed, 3 dewasa, total sistem Rp287.000.
 *
 * Tidak menyentuh database produksi.
 */
import assert from "node:assert/strict";
import { stripBotExampleText } from "../src/lib/guest-party";
import { planInitialBookingPayment, createBooking } from "../src/tools/booking.tool";
import { buildInvoicePaymentLines } from "../src/services/invoice-notification.service";
import { guestNameSafeForThreadDisplay } from "../src/ai/state-machine/booking-summary-text";
import { resolveOrCreateNotificationThread } from "../src/services/invoice-notification.service";
import {
  extractAllSlots,
  extractGuestNameFromMessage,
} from "../src/ai/state-machine/flexible-slot-extractor";
import {
  isBookingConfirmationMessage,
  isBookingNegationOrCorrection,
  processBookingState,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";

const TODAY = "2026-11-22";
const WA = "628123000111";
const CHECK_IN = "2026-11-22";
const CHECK_OUT = "2026-11-23";
const ROOM_RATE = 207000;
const EXTRA_RATE = 80000;
const QUOTED = ROOM_RATE + EXTRA_RATE;

const DELUXE = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: ROOM_RATE,
  capacity: 2,
  extrabed_capacity: 1,
  extrabed_rate: EXTRA_RATE,
};

const PAY_AND_CONFIRM = "Sudah betul, bayar di lokasi nanti saat check in";

const PASTE = `Data booking sementara:
Kamar: Deluxe, Check-in: 22 November 2026, Check-out: 23 November 2026, No HP: ${WA}, Dewasa: 3

Mohon lengkapi data berikut untuk melanjutkan reservasi:
1. Nama lengkap tamu HUSNI HARIS

Kakak bisa mengetikkan data di atas sekaligus (contoh: "booking Deluxe, atas nama Budi, tanggal 25-27 Juni, 2 dewasa 1 anak").`;

function makeDb() {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
    updates: [] as Array<Record<string, unknown>>,
  };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt", "not", "or", "is"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "row-1" }, error: null });
    b.insert = () => b;
    b.update = (patch: Record<string, unknown>) => {
      if (table === "whatsapp_threads") rec.updates.push(patch);
      const u: any = { eq: () => u, then: (resolve: (value: unknown) => unknown) => resolve({ error: null }) };
      return u;
    };
    b.upsert = async () => ({ error: null });
    b.then = (resolve: (value: unknown) => unknown) => {
      if (table === "whatsapp_threads") {
        return resolve({
          data: [{ id: "th-husni", phone: WA, canonical_phone: WA, last_message_at: "2026-11-22T10:24:00.000Z" }],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    };
    return b;
  };
  const db: any = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: any) => {
      if (name === "update_booking_state") {
        rec.states.push({ state: args.p_state, context: JSON.parse(JSON.stringify(args.p_context)) });
      }
      return { data: null, error: null };
    },
  };
  return { db, rec };
}

function ctxOf(db: any) {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms: [DELUXE],
    property: {
      id: "prop-1",
      payment_bank_name: "BCA",
      payment_account_number: "123",
      payment_account_holder: "Pomah",
    },
    today: TODAY,
    phone: WA,
  };
}

function record(state: StateRecord["state"], context: BookingContext, updatedAt = "2026-11-22T10:24:00.000Z"): StateRecord {
  return { phone: WA, state, context, updated_at: updatedAt, slots: {} };
}

function draft(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    roomId: DELUXE.id,
    roomName: "Deluxe",
    pricePerNight: ROOM_RATE,
    totalPrice: QUOTED,
    quotedTotal: QUOTED,
    guestPhone: WA,
    adults: 3,
    children: 0,
    extraBeds: 1,
    extraBedRate: EXTRA_RATE,
    datesConfirmed: true,
    rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: ROOM_RATE }],
    lastSummary: {
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms: [{ roomTypeId: DELUXE.id, quantity: 1 }],
      adults: 3,
      children: 0,
      total: QUOTED,
    },
    ...over,
  };
}

function writer() {
  const calls: Array<Record<string, unknown>> = [];
  const impl = async (args: Record<string, unknown>) => {
    calls.push(args);
    return JSON.stringify({ ok: true, reference_code: "PG-BSH8P", total: QUOTED });
  };
  return { calls, impl };
}

assert.equal(extractGuestNameFromMessage("1. Nama lengkap tamu HUSNI HARIS", { awaitingName: true }), "HUSNI HARIS");
assert.equal(extractGuestNameFromMessage("1. Nama lengkap: HUSNI HARIS", { awaitingName: true }), "HUSNI HARIS");
assert.equal(extractGuestNameFromMessage("Nama tamu - HUSNI HARIS", { awaitingName: true }), "HUSNI HARIS");
assert.equal(extractGuestNameFromMessage("lengkap tamu HUSNI HARIS", { awaitingName: true, allowUnlabeled: true }), "HUSNI HARIS");
assert.equal(extractGuestNameFromMessage("1. Nama lengkap tamu", { awaitingName: true }), null);
assert.equal(extractGuestNameFromMessage(PASTE, { awaitingName: true, rooms: [DELUXE] }), "HUSNI HARIS");
assert.equal(guestNameSafeForThreadDisplay("HUSNI HARIS"), "HUSNI HARIS");
assert.equal(guestNameSafeForThreadDisplay("lengkap tamu HUSNI HARIS"), null);
assert.equal(guestNameSafeForThreadDisplay("Nama lengkap tamu HUSNI HARIS"), null);

{
  const stripped = stripBotExampleText(PASTE);
  assert.doesNotMatch(stripped, /2 dewasa 1 anak/);
  assert.doesNotMatch(stripped, /atas nama Budi/i);
  const slots = extractAllSlots(PASTE, [DELUXE], WA, TODAY);
  assert.equal(slots.guest_name, "HUSNI HARIS");
  assert.equal(slots.adults, 3);
  assert.equal(slots.children, 0);
  assert.notEqual(slots.check_in, "2026-06-25");
  assert.notEqual(slots.check_in, "2027-06-25");
}

assert.equal(isBookingNegationOrCorrection(PAY_AND_CONFIRM), false);
assert.equal(isBookingConfirmationMessage(PAY_AND_CONFIRM), true);
assert.equal(isBookingNegationOrCorrection("ya check in tgl 12"), true);
assert.equal(isBookingConfirmationMessage("ya check in tgl 12"), false);
assert.equal(isBookingConfirmationMessage("Sudah betul"), true);
assert.equal(isBookingConfirmationMessage("bayar di tempat ya kak"), false);

const onsitePlan = planInitialBookingPayment({ nights: 1, total: QUOTED, paymentType: "onsite", now: 0 });
assert.equal(onsitePlan.paymentMethod, "onsite");
assert.equal(onsitePlan.expiresAt, null);
const invoice = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: QUOTED,
  nights: 1,
  paymentMethod: "onsite",
  expiresAt: null,
  bankDetails: "\n\nTransfer Pembayaran:\nBANK",
});
assert.match(invoice, /Bayar di Tempat/);
assert.match(invoice, /Pembayaran dilakukan di tempat saat check-in/);
assert.match(invoice, /Total: Rp 287\.000/);
assert.doesNotMatch(invoice, /Menunggu pembayaran|pembayaran ditunggu|dibatalkan|1 jam|Batas waktu|Transfer Pembayaran/i);

async function main() {
  // (a) tempelan template: nama bersih, 3 dewasa, 0 anak, tidak over kapasitas.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      PASTE,
      record("COLLECTING_DATA", draft({ guestName: undefined, lastSummary: undefined })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0);
    const saved = rec.states.at(-1)!;
    assert.equal(saved.context.guestName, "HUSNI HARIS");
    assert.equal(saved.context.adults, 3);
    assert.equal(saved.context.children, 0);
    assert.equal(saved.context.checkIn, CHECK_IN);
    assert.equal(saved.context.checkOut, CHECK_OUT);
    assert.equal(saved.state, "CONFIRMING_BOOKING");
    assert.doesNotMatch(reply.reply ?? "", /melebihi kapasitas|4 tamu/i);
    assert.equal(saved.context.totalPrice, saved.context.quotedTotal);
    assert.equal(saved.context.quotedTotal, QUOTED);
    assert.equal(saved.context.extraBeds, 1);
  }

  // (b) afirmasi + bayar di lokasi saat check in → satu createBooking, onsite, tanpa ringkasan kedua.
  {
    const { db } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      PAY_AND_CONFIRM,
      record("CONFIRMING_BOOKING", draft({ guestName: "HUSNI HARIS" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 1, "tepat satu createBooking");
    assert.equal(w.calls[0].payment_type, "onsite");
    assert.equal(w.calls[0].full_name, "HUSNI HARIS");
    assert.equal(w.calls[0].extra_beds, 1);
    assert.equal(w.calls[0].adults, 3);
    assert.equal(w.calls[0].children, 0);
    assert.equal(w.calls[0].expected_total, QUOTED);
    assert.match(reply.reply ?? "", /PG-BSH8P/);
    assert.match(reply.reply ?? "", /berhasil dibuat/i);
    assert.doesNotMatch(reply.reply ?? "", /Berikut ringkasannya|Data pemesanan sudah lengkap|Bisa Kak, pembayarannya/i);
    assert.equal(reply.followUp, "send_invoice");
  }

  // (c) "Sudah betul" setelah ringkasan onsite tetap onsite (1 malam tidak dipaksa transfer lunas).
  {
    const { db } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Sudah betul",
      record("CONFIRMING_BOOKING", draft({ guestName: "HUSNI HARIS", paymentType: "onsite" }), "2026-11-22T10:30:00.000Z"),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0].payment_type, "onsite");
    assert.match(reply.reply ?? "", /berhasil dibuat/i);
    assert.doesNotMatch(reply.reply ?? "", /Berikut ringkasannya/i);
  }

  // bookingCode yang sudah ada tidak membuat booking kedua.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Sudah betul",
      record("CONFIRMING_BOOKING", draft({ guestName: "HUSNI HARIS", paymentType: "onsite", bookingCode: "PG-BSH8P" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0, "bookingCode menghalangi createBooking ganda");
    assert.equal(rec.states.at(-1)!.state, "PAYMENT_PENDING");
    assert.equal(rec.states.at(-1)!.context.bookingCode, "PG-BSH8P");
    assert.equal(reply.handled, false);
  }

  // display_name thread tidak ditimpa nama yang masih berisi kata template.
  {
    const { db, rec } = makeDb();
    await resolveOrCreateNotificationThread({
      supabase: db,
      phone: WA,
      displayName: "lengkap tamu HUSNI HARIS",
      guestId: "guest-1",
    });
    assert.equal(rec.updates.at(-1)?.display_name, undefined);
    assert.equal(rec.updates.at(-1)?.guest_id, "guest-1");
    await resolveOrCreateNotificationThread({
      supabase: db,
      phone: WA,
      displayName: "HUSNI HARIS",
      guestId: "guest-1",
    });
    assert.equal(rec.updates.at(-1)?.display_name, "HUSNI HARIS");
  }

  // (d) extra bed masuk payload booking_rooms; onsite tanpa expires_at; tarif dari kalender.
  {
    const inserts: Array<{ table: string; row: any }> = [];
    const daily = [
      {
        room_type_id: DELUXE.id,
        date: CHECK_IN,
        rate: ROOM_RATE,
        extrabed_rate: EXTRA_RATE,
        min_stay: 1,
        stop_sell: false,
        note: null,
      },
    ];
    const mk = (table: string) => {
      const b: any = {};
      let op = "select";
      for (const m of ["select", "eq", "order", "limit", "in", "gte", "lte", "lt", "gt", "not", "or", "neq", "is"]) {
        b[m] = () => b;
      }
      b.insert = (row: any) => {
        op = "insert";
        inserts.push({ table, row });
        return b;
      };
      b.update = () => b;
      b.delete = () => b;
      b.upsert = async () => ({ error: null });
      b.maybeSingle = async () => ({ data: null, error: null });
      b.single = async () => {
        if (op === "insert" && table === "guests") return { data: { id: "guest-1" }, error: null };
        if (op === "insert" && table === "bookings") {
          return { data: { id: "book-1", reference_code: "PG-BSH8P" }, error: null };
        }
        return { data: null, error: { message: "not found" } };
      };
      b.then = (resolve: (value: unknown) => unknown) => {
        if (table === "rooms") {
          return resolve({ data: [{ id: "room-205", number: "205", room_type_id: DELUXE.id }], error: null });
        }
        if (table === "room_daily_rates") return resolve({ data: daily, error: null });
        return resolve({ data: [], error: null });
      };
      return b;
    };
    const admin: any = { from: (table: string) => mk(table) };
    const pub: any = {
      from: (table: string) => mk(table),
      rpc: async () => ({ data: [{ room_type_id: DELUXE.id, available: 1 }], error: null }),
    };
    const ctx: any = {
      supabaseAdmin: admin,
      supabasePublic: pub,
      rooms: [{ ...DELUXE, base_rate: 230000 }],
      property: { id: "prop-1" },
      today: TODAY,
      phone: WA,
    };
    const raw = await createBooking(
      {
        room_type: "Deluxe",
        rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: 230000 }],
        full_name: "HUSNI HARIS",
        phone: WA,
        check_in: CHECK_IN,
        check_out: CHECK_OUT,
        adults: 3,
        children: 0,
        extra_beds: 1,
        payment_type: "onsite",
        expected_total: QUOTED,
      },
      ctx,
    );
    const out = JSON.parse(raw);
    assert.equal(out.ok, true, raw);
    assert.equal(out.total, QUOTED);
    assert.equal(out.reference_code, "PG-BSH8P");
    const booking = inserts.find((row) => row.table === "bookings" && !Array.isArray(row.row));
    assert.ok(booking, "bookings insert");
    assert.equal(booking!.row.payment_method, "onsite");
    assert.equal(booking!.row.expires_at, null);
    assert.equal(booking!.row.total_amount, QUOTED);
    const rooms = inserts.find((row) => row.table === "booking_rooms");
    assert.ok(rooms, "booking_rooms insert");
    const roomRows = Array.isArray(rooms!.row) ? rooms!.row : [rooms!.row];
    assert.equal(roomRows.length, 1);
    assert.equal(roomRows[0].room_id, "room-205");
    assert.equal(roomRows[0].extra_bed_count, 1);
    assert.equal(roomRows[0].extra_bed_rate, EXTRA_RATE);
    assert.equal(roomRows[0].nightly_rate, ROOM_RATE);
  }

  console.log("husni booking gaps: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
