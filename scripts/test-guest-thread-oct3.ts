/**
 * Regresi thread tamu 3 Okt 2026 (a–f).
 *
 * `bun run test:guest-thread-oct3`
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import {
  parseGuestCountFollowup,
  guestsFromStoredSlots,
} from "../src/services/wa-autoreply/message-parsers";
import { resolveStartBookingGuests } from "../src/tools/start-booking.tool";
import { formatAvailabilityReply } from "../src/services/wa-autoreply/availability-formatters";
import {
  buildPaymentPolicyAnswer,
  isGuestPaymentQuestion,
  parseStayNightsFromMessage,
} from "../src/ai/state-machine/booking-inline-answers";
import { buildPropertyFaqReply } from "../src/services/property-faq";
import { planInitialBookingPayment } from "../src/tools/booking.tool";
import { buildInvoicePaymentLines } from "../src/services/invoice-notification.service";
import {
  OFFICIAL_TRANSFER_ACCOUNT,
  resolveBotTransferAccount,
  formatTransferAccountLine,
} from "../src/lib/payment-account";
import {
  formatGuestNameForSummary,
  bookingSummaryLead,
} from "../src/ai/state-machine/booking-summary-text";
import {
  buildCapacityAlternatives,
  fitPartyToOneRoom,
  parseCapacityFollowup,
  type RoomStock,
} from "../src/ai/state-machine/capacity-alternatives";
import {
  isStaffOutboundMetadata,
  staffSilenceUntil,
  STAFF_REPLY_SILENCE_MS,
} from "../src/services/wa-autoreply/staff-silence";
import {
  processBookingState,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";

const WA = "6281234567890";
const DELUXE = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: 350000,
  capacity: 2,
  extrabed_capacity: 1,
  extrabed_rate: 80000,
};
const FAMILY = {
  id: "rt-family",
  name: "Family Room 222",
  base_rate: 500000,
  capacity: 4,
  extrabed_capacity: 0,
  extrabed_rate: 0,
};

function makeDb(availability: Array<{ room_type_id: string; available: number | null }>) {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
    inserts: [] as Array<{ table: string; row: any }>,
  };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "ticket-1" }, error: null });
    b.insert = (row: any) => {
      rec.inserts.push({ table, row });
      return b;
    };
    b.update = () => b;
    b.then = (resolve: any) => resolve({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: any) => {
      if (name === "update_booking_state") {
        rec.states.push({
          state: args.p_state,
          context: JSON.parse(JSON.stringify(args.p_context)),
        });
      }
      if (name === "room_type_availability_detail")
        return Promise.resolve({ data: availability, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rec };
}

function ctxOf(db: any) {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms: [DELUXE, FAMILY],
    property: {
      id: "prop-1",
      payment_bank_name: "Mandiri",
      payment_account_number: "1234567890",
      payment_account_holder: "Nama Lama",
    },
    today: "2026-10-03",
    phone: WA,
  };
}

function record(state: StateRecord["state"], context: BookingContext): StateRecord {
  return { phone: WA, state, context, updated_at: "2026-10-03T01:00:00.000Z", slots: {} };
}

function baseContext(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    roomId: DELUXE.id,
    roomName: "Deluxe",
    pricePerNight: 350000,
    totalPrice: 700000,
    quotedTotal: 700000,
    guestName: "Tri Handoyo",
    guestPhone: WA,
    adults: 2,
    children: 0,
    rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: 350000 }],
    ...over,
  };
}

// (a) 4 (1 anak kecil) = total 4
assert.deepEqual(parseGuestCountFollowup("4 (1 anak kecil)"), { adults: 3, children: 1, total: 4 });
assert.deepEqual(guestsFromStoredSlots({ partialAdults: 3, partialChildren: 1 }), {
  adults: 3,
  children: 1,
  total: 4,
});
assert.deepEqual(
  resolveStartBookingGuests({ adults: 1, children: 0 }, { partialAdults: 3, partialChildren: 1 }),
  { adults: 3, children: 1 },
);
assert.deepEqual(
  resolveStartBookingGuests({ adults: 2, children: 0 }, { partialAdults: 3, partialChildren: 1 }),
  { adults: 2, children: 0 },
);

const known = formatAvailabilityReply(
  JSON.stringify({
    periode: "10-12 Okt 2026",
    kamar: [
      {
        nama: "Deluxe",
        kamar_tersedia: 3,
        harga_per_malam: 350000,
        tidak_tersedia: false,
        cocok_untuk_jumlah_tamu: true,
        kapasitas_maksimal_dengan_extra_bed: 3,
      },
    ],
  }),
  false,
  null,
  { adults: 3, children: 1, total: 4 },
);
assert.ok(known);
assert.doesNotMatch(known.reply, /berapa orang/i);

// (b) alternatif kapasitas
const deluxeStock: RoomStock = {
  roomTypeId: DELUXE.id,
  name: DELUXE.name,
  capacity: 2,
  extrabedCapacity: 1,
  extrabedRate: 80000,
  pricePerNight: 350000,
  available: 3,
};
const familyStock: RoomStock = {
  roomTypeId: FAMILY.id,
  name: FAMILY.name,
  capacity: 4,
  extrabedCapacity: 0,
  extrabedRate: 0,
  pricePerNight: 500000,
  available: 2,
};
const choices = buildCapacityAlternatives({
  guests: 4,
  nights: 2,
  selected: deluxeStock,
  catalog: [deluxeStock, familyStock],
});
assert.ok(choices.some((c) => c.kind === "same_type" && c.quantity === 2));
assert.ok(choices.some((c) => c.kind === "fit_type" && c.room.name === "Family Room 222"));
assert.equal(parseCapacityFollowup("pesan 1 dulu"), "book_one");
assert.equal(parseCapacityFollowup("tambah kamar"), "add_room");
assert.deepEqual(fitPartyToOneRoom(4, 0, 3), { adults: 3, children: 0, adjusted: true });

const availability = [
  { room_type_id: DELUXE.id, available: 3 },
  { room_type_id: FAMILY.id, available: 2 },
];
{
  const { db, rec } = makeDb(availability);
  const first = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", baseContext({ adults: 4, children: 0, totalPrice: 700000 })),
  );
  assert.equal(first.handled, true);
  assert.match(first.reply ?? "", /2x Deluxe/);
  assert.match(first.reply ?? "", /Family Room 222/);
  assert.match(first.reply ?? "", /Rp/);
  assert.doesNotMatch(first.reply ?? "", /jumlah tamu melebihi maksimal/);
  const afterFirst = rec.states.at(-1)!.context;
  const second = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", afterFirst),
  );
  assert.match(second.reply ?? "", /2x Deluxe|Family Room 222/);
  const afterSecond = rec.states.at(-1)!.context;
  const third = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", afterSecond),
  );
  assert.match(third.reply ?? "", /tim kami/);
  assert.equal(
    rec.inserts.some(
      (row) => row.table === "handoff_tickets" && row.row.frustration_kind === "capacity_dead_end",
    ),
    true,
  );
  const afterThird = rec.states.at(-1)!.context;
  const fourth = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", afterThird),
  );
  assert.equal(fourth.silent, true);
  assert.equal(fourth.reply, undefined);
}

{
  const { db, rec } = makeDb(availability);
  const booked = await processBookingState(
    ctxOf(db) as any,
    WA,
    "pesan 1 dulu",
    record(
      "CONFIRMING_BOOKING",
      baseContext({
        adults: 4,
        children: 0,
        capacityBlockerStreak: 1,
        capacityBlockerFingerprint: "x",
      }),
    ),
  );
  assert.match(booked.reply ?? "", /sesuaikan/);
  assert.match(booked.reply ?? "", /3 dewasa/);
  assert.equal(rec.states.at(-1)!.context.rooms?.[0]?.quantity, 1);
}

{
  const { db, rec } = makeDb(availability);
  const added = await processBookingState(
    ctxOf(db) as any,
    WA,
    "tambah kamar",
    record(
      "CONFIRMING_BOOKING",
      baseContext({
        adults: 4,
        children: 0,
        capacityBlockerStreak: 1,
        capacityBlockerFingerprint: "x",
      }),
    ),
  );
  assert.equal(rec.states.at(-1)!.context.rooms?.[0]?.quantity, 2);
  assert.match(added.reply ?? "", /2x Deluxe|Deluxe/);
}

// (c) diam setelah staf, dan small talk tidak mengulang ringkasan
const now = Date.parse("2026-10-03T09:00:00.000Z");
const staffUntil = staffSilenceUntil(
  [
    {
      direction: "out",
      sent_at: "2026-10-03T08:44:00.000Z",
      metadata: { is_native_human: true, source: "whatsapp_native" },
    },
  ],
  now,
);
assert.ok(staffUntil);
assert.equal(
  Date.parse(staffUntil!) - Date.parse("2026-10-03T08:44:00.000Z"),
  STAFF_REPLY_SILENCE_MS,
);
assert.equal(
  staffSilenceUntil(
    [
      {
        direction: "out",
        sent_at: "2026-10-03T08:50:00.000Z",
        metadata: { agent: "front-office", agent_key: "fo" },
      },
    ],
    now,
  ),
  null,
);
assert.equal(isStaffOutboundMetadata({ is_ack: true, is_native_human: true }), false);

{
  const { db } = makeDb(availability);
  const chat = await processBookingState(
    ctxOf(db) as any,
    WA,
    "Sementara itu dulu Kak",
    record(
      "CONFIRMING_BOOKING",
      baseContext({ adults: 3, children: 14, guestName: "Tri Handoyo" }),
    ),
  );
  assert.equal(chat.handled, true);
  assert.doesNotMatch(chat.reply ?? "", /Data pemesanan sudah lengkap/);
  assert.doesNotMatch(chat.reply ?? "", /14 anak/);
}

// (d) nama dan header
assert.equal(formatGuestNameForSummary("Tri Handoyo ( )"), "Tri Handoyo");
assert.equal(formatGuestNameForSummary("Tri Handoyo (081234567890)"), "Tri Handoyo");
assert.equal(bookingSummaryLead(false).includes("Data pemesanan sudah lengkap"), false);
assert.equal(bookingSummaryLead(true).includes("Data pemesanan sudah lengkap"), true);
{
  const { db } = makeDb(availability);
  const summary = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ringkasan",
    record("CONFIRMING_BOOKING", baseContext({ guestName: "Tri Handoyo ( )", guestEmail: "" })),
  );
  assert.match(summary.reply ?? "", /Nama: Tri Handoyo\n/);
  assert.doesNotMatch(summary.reply ?? "", /Nama: Tri Handoyo \(/);
  assert.doesNotMatch(summary.reply ?? "", /tidak diisi/);
  const overflow = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ringkasan",
    record("CONFIRMING_BOOKING", baseContext({ adults: 4, children: 0 })),
  );
  assert.doesNotMatch(overflow.reply ?? "", /Data pemesanan sudah lengkap/);
}

// (e)(f) 1 malam tanpa DP, 2+ malam DP 50% tetap, satu rekening
const transfer = formatTransferAccountLine();
assert.equal(transfer, "BCA 0095584379 a.n. Faizal Abdurachman");
const conflicting = resolveBotTransferAccount({
  payment_bank_name: "Mandiri",
  payment_account_number: "1234567890",
  payment_account_holder: "Nama Lama",
});
assert.equal(conflicting.accountNumber, OFFICIAL_TRANSFER_ACCOUNT.accountNumber);
assert.equal(conflicting.bankName, "BCA");

const oneNight = buildPaymentPolicyAnswer({ nights: 1, totalPrice: 350000 });
assert.match(oneNight, /bayar langsung di tempat/i);
assert.match(oneNight, /0095584379/);
assert.match(oneNight, /Faizal Abdurachman/);
assert.match(oneNight, /tanpa DP/i);
assert.doesNotMatch(oneNight, /tidak bisa bayar di tempat/i);
assert.doesNotMatch(oneNight, /DP dulu 50%/);

const twoNights = buildPaymentPolicyAnswer({ nights: 2, totalPrice: 700000 });
assert.match(twoNights, /DP dulu 50%/);
assert.match(twoNights, /Rp350\.000/);
assert.match(twoNights, /0095584379/);
assert.doesNotMatch(twoNights, /tidak bisa bayar di tempat/i);

assert.equal(parseStayNightsFromMessage("1 malam bisa DP?"), 1);
assert.equal(isGuestPaymentQuestion("tidak bisa bayar di tempat?"), true);
const faqOne = buildPropertyFaqReply({
  message: "1 malam bisa DP / bayar di tempat?",
  property: { payment_bank_name: "Mandiri", payment_account_number: "123" },
  rooms: [],
  mode: "early",
});
assert.equal(faqOne?.intent, "faq_payment_policy");
assert.match(faqOne?.reply ?? "", /bayar langsung di tempat/i);
assert.match(faqOne?.reply ?? "", /0095584379/);
assert.doesNotMatch(faqOne?.reply ?? "", /tidak bisa bayar di tempat/i);
assert.doesNotMatch(faqOne?.reply ?? "", /123/);

const onePlan = planInitialBookingPayment({
  nights: 1,
  total: 350000,
  paymentType: "dp",
  dpAmount: 175000,
  now: Date.parse("2026-10-03T00:00:00.000Z"),
});
assert.equal(onePlan.paymentStatus, "unpaid");
assert.equal(onePlan.paidAmount, 0);
assert.equal(onePlan.expiresAt, null);
const twoPlan = planInitialBookingPayment({
  nights: 2,
  total: 700000,
  paymentType: "dp",
  dpAmount: 350000,
  now: Date.parse("2026-10-03T00:00:00.000Z"),
});
assert.equal(twoPlan.paymentStatus, "partial");
assert.equal(twoPlan.paidAmount, 350000);
assert.ok(twoPlan.expiresAt);

const invoiceOne = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 350000,
  nights: 1,
  expiresAt: "2026-10-03T01:00:00.000Z",
  bankDetails: "\n\nTransfer Pembayaran:\nBANK LAMA",
});
assert.match(invoiceOne, /tanpa DP/);
assert.match(invoiceOne, /0095584379/);
assert.doesNotMatch(invoiceOne, /dibatalkan/);
assert.doesNotMatch(invoiceOne, /Menunggu pembayaran/);
assert.doesNotMatch(invoiceOne, /BANK LAMA/);
const invoiceTwo = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 700000,
  nights: 2,
  expiresAt: "2026-10-03T01:00:00.000Z",
  bankDetails: "\n\nTransfer Pembayaran:\n🏦 Bank: BCA",
});
assert.match(invoiceTwo, /Menunggu pembayaran/);
assert.match(invoiceTwo, /dibatalkan/);

{
  const { db } = makeDb(availability);
  const ask = await processBookingState(
    ctxOf(db) as any,
    WA,
    "bisa DP / bayar di tempat?",
    record(
      "CONFIRMING_BOOKING",
      baseContext({ checkOut: "2026-10-11", adults: 2, totalPrice: 350000 }),
    ),
  );
  assert.match(ask.reply ?? "", /bayar langsung di tempat/i);
  assert.match(ask.reply ?? "", /0095584379/);
  assert.doesNotMatch(ask.reply ?? "", /tidak bisa bayar di tempat/i);
  assert.doesNotMatch(ask.reply ?? "", /DP dulu 50%/);
  const summary = await processBookingState(
    ctxOf(db) as any,
    WA,
    "ringkasan",
    record(
      "CONFIRMING_BOOKING",
      baseContext({
        checkOut: "2026-10-11",
        adults: 2,
        totalPrice: 350000,
        paymentType: "dp",
        dpAmount: 175000,
      }),
    ),
  );
  assert.match(summary.reply ?? "", /tanpa DP/);
  assert.doesNotMatch(summary.reply ?? "", /DP 175|DP Rp175/);
}

console.log("✓ guest thread 3 Okt regressions passed");
