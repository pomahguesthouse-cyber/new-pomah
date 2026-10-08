/**
 * Extra bed opsional (insiden Indri, 8 Okt 2026).
 *
 * Deluxe kapasitas 2 + 1 extra bed Rp80.000. 2 dewasa + 1 anak 7 th boleh
 * ditawari extra bed, tetapi penolakan menghapusnya dari ringkasan dan dari
 * booking. Penolakan kedua tidak memasangnya lagi. Bayi < 3 th tidak dihitung.
 * 4 tamu di Deluxe tetap butuh kamar lebih besar atau 2 kamar.
 */
import assert from "node:assert/strict";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext } from "../src/ai/agents/types";
import {
  EXTRA_BED_DECLINED_NOTE,
  processBookingState,
  resolveExtraBedPolicy,
  type BookingContext,
  type RoomExtraBedPolicy,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";
import { createBooking } from "../src/tools/booking.tool";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WA = "6281234567890";
const DELUXE = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: 230000,
  capacity: 2,
  bed_type: null,
  description: null,
  extrabed_capacity: 1,
  extrabed_rate: 80000,
};
const FAMILY = {
  id: "rt-family",
  name: "Family Room 222",
  base_rate: 500000,
  capacity: 4,
  bed_type: null,
  description: null,
  extrabed_capacity: 0,
  extrabed_rate: 0,
};

const POLICY: RoomExtraBedPolicy = {
  roomTypeId: DELUXE.id,
  roomTypeName: "Deluxe",
  capacity: 2,
  extrabedCapacity: 1,
  extrabedRate: 80000,
};

assert.equal(
  resolveExtraBedPolicy(POLICY, 1, 3, {}).extraBeds,
  1,
  "3 tamu di Deluxe boleh ditawari 1 extra bed",
);
assert.equal(
  resolveExtraBedPolicy(POLICY, 1, 3, { extraBeds: 1, extraBedsDeclined: true }).extraBeds,
  0,
  "penolakan memaksa 0",
);
assert.equal(
  resolveExtraBedPolicy(POLICY, 1, 3, { extraBeds: 0, extraBedsDeclined: true }).overCapacity,
  false,
  "3 tamu masih muat tanpa extra bed",
);
assert.equal(
  resolveExtraBedPolicy(POLICY, 1, 2, {}).extraBeds,
  0,
  "bayi yang tidak dihitung tidak butuh extra bed",
);
assert.equal(resolveExtraBedPolicy(POLICY, 1, 4, {}).overCapacity, true, "4 tamu melebihi kapasitas + extra bed");

function makeDb(availability: Array<{ room_type_id: string; available: number | null }> = []) {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
    upserts: [] as any[],
    inserts: [] as any[],
  };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt", "not", "or"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "ticket-1" }, error: null });
    b.insert = (row: any) => {
      rec.inserts.push({ table, row });
      return b;
    };
    b.upsert = (row: any, opts: any) => {
      rec.upserts.push({ table, row, opts });
      return Promise.resolve({ error: null });
    };
    b.update = () => {
      const u: any = { eq: () => u, then: (resolve: any) => resolve({ error: null }) };
      return u;
    };
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
      if (name === "room_type_availability_detail") {
        return Promise.resolve({ data: availability, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rec };
}

function makeCtx(db: any, rooms = [DELUXE, FAMILY]) {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms,
    property: { id: "prop-1" },
    today: "2026-10-08",
    phone: WA,
  };
}

function indriContext(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: "2026-10-08",
    checkOut: "2026-10-09",
    roomId: DELUXE.id,
    roomName: "Deluxe",
    pricePerNight: 230000,
    totalPrice: 230000,
    quotedTotal: 310000,
    guestName: "Indri",
    guestPhone: WA,
    adults: 2,
    children: 1,
    childAges: [7],
    extraBeds: 1,
    extraBedRate: 80000,
    rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: 230000 }],
    ...over,
  };
}

function record(state: StateRecord["state"], context: BookingContext): StateRecord {
  return { phone: WA, state, context, updated_at: "2026-10-08T02:00:00.000Z", slots: {} };
}

function makeWriter() {
  const calls: Array<{ args: any; ctx: any }> = [];
  const impl = (async (args: any, ctx: any) => {
    calls.push({ args, ctx });
    return JSON.stringify({ ok: true, reference_code: "PG-INDRI", total: 230000, guest: { full_name: "Indri" } });
  }) as typeof createBooking;
  return { impl, calls };
}

const availability = [
  { room_type_id: DELUXE.id, available: 3 },
  { room_type_id: FAMILY.id, available: 2 },
];

{
  const { db, rec } = makeDb(availability);
  const quote = await processBookingState(
    makeCtx(db) as any,
    WA,
    "ringkasan",
    record("CONFIRMING_BOOKING", indriContext({ extraBeds: undefined, quotedTotal: undefined })),
  );
  assert.equal(quote.handled, true);
  assert.match(quote.reply ?? "", /Extra bed:/);
  assert.match(quote.reply ?? "", /opsional/);
  assert.match(quote.reply ?? "", /Rp310\.000/);
  assert.equal(rec.states.at(-1)!.context.extraBeds, 1);

  const declined = await processBookingState(
    makeCtx(db) as any,
    WA,
    "extra bed nya gausah kak",
    record("CONFIRMING_BOOKING", rec.states.at(-1)!.context),
  );
  assert.equal(declined.handled, true);
  assert.doesNotMatch(declined.reply ?? "", /saya tunggu kabarnya/i);
  assert.match(declined.reply ?? "", /Rp230\.000/);
  assert.doesNotMatch(declined.reply ?? "", /Extra bed:/i);
  assert.doesNotMatch(declined.reply ?? "", /80\.000/);
  assert.doesNotMatch(declined.reply ?? "", /Rp310\.000/);
  const afterDecline = rec.states.at(-1)!.context;
  assert.equal(afterDecline.extraBeds, 0);
  assert.equal(afterDecline.extraBedsDeclined, true);

  const declinedAgain = await processBookingState(
    makeCtx(db) as any,
    WA,
    "itu extra bed nya gausah jadi bayar kamarnya saja ya?",
    record("CONFIRMING_BOOKING", afterDecline),
  );
  assert.equal(declinedAgain.handled, true);
  assert.doesNotMatch(declinedAgain.reply ?? "", /saya tunggu kabarnya/i);
  assert.match(declinedAgain.reply ?? "", /Rp230\.000/);
  assert.doesNotMatch(declinedAgain.reply ?? "", /Extra bed:/i);
  assert.equal(rec.states.at(-1)!.context.extraBeds, 0);
  assert.equal(rec.states.at(-1)!.context.extraBedsDeclined, true);

  const writer = makeWriter();
  const confirmed = await processBookingState(
    makeCtx(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", rec.states.at(-1)!.context),
    { createBookingImpl: writer.impl },
  );
  assert.equal(confirmed.handled, true);
  assert.equal(writer.calls.length, 1);
  assert.equal(writer.calls[0].args.extra_beds, 0);
  const note = String(writer.calls[0].args.special_requests ?? "");
  assert.ok(note.includes("Tanpa extra bed"), note);
  assert.ok(note.includes(EXTRA_BED_DECLINED_NOTE), note);
}

{
  const { db } = makeDb(availability);
  const baby = await processBookingState(
    makeCtx(db) as any,
    WA,
    "sudah lengkap",
    record(
      "COLLECTING_DATA",
      indriContext({
        children: 1,
        childAges: [1],
        extraBeds: undefined,
        extraBedRate: undefined,
        quotedTotal: undefined,
      }),
    ),
  );
  assert.equal(baby.handled, true);
  assert.doesNotMatch(baby.reply ?? "", /Extra bed:/i);
  assert.doesNotMatch(baby.reply ?? "", /80\.000/);
  assert.match(baby.reply ?? "", /Rp230\.000/);
}

{
  const { db } = makeDb(availability);
  const overflow = await processBookingState(
    makeCtx(db) as any,
    WA,
    "ya",
    record("CONFIRMING_BOOKING", indriContext({ adults: 4, children: 0, childAges: undefined, extraBeds: undefined })),
  );
  assert.equal(overflow.handled, true);
  assert.match(overflow.reply ?? "", /Family Room 222|2x Deluxe/);
  assert.match(overflow.reply ?? "", /kapasitas/i);
}

{
  const prompt = frontOfficeAgent.buildSystemPrompt({
    property: { name: "Pomah Guesthouse" },
    rooms: [{ name: "Deluxe", base_rate: 230000, capacity: 2 }],
    sopText: "",
    today: "2026-10-08",
  } as unknown as AgentContext);
  assert.match(prompt, /EXTRA BED OPSIONAL/);
  assert.match(prompt, /jangan ulangi penjelasan kapasitas/i);
  assert.match(prompt, /bawah 3 tahun/i);
}

console.log("extra-bed policy regressions: OK");
