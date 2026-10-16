/**
 * Pindah kamar untuk booking yang SUDAH ada (insiden Azairul PG-HJ5MF, 16 Okt 2026):
 * bot memberi rincian total baru / sudah dibayar / sisa, teruskan ke staf saat "ya",
 * dan TIDAK pernah membuat booking kedua untuk tanggal yang bertabrakan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRoomChangeQuote,
  findOverlappingBooking,
  formatRoomChangeQuoteReply,
  toSnapshot,
  type ActiveBookingSnapshot,
} from "../src/services/room-change-quote";
import { processBookingState, ROOM_CHANGE_INTENT_RE, type BookingContext, type StateRecord } from "../src/ai/state-machine/booking-machine";
import { recalcBookingAfterRoomChange, paymentStatusFor } from "../src/tools/manager/change-booking-room.tool";

/* eslint-disable @typescript-eslint/no-explicit-any */
const WA = "6285218818868";
const SINGLE = { id: "rt-single", name: "Single", base_rate: 150000, capacity: 1, bed_type: null, description: null, extrabed_capacity: 1, extrabed_rate: 80000 };
const DELUXE = { id: "rt-deluxe", name: "Deluxe", base_rate: 230000, capacity: 2, bed_type: null, description: null, extrabed_capacity: 1, extrabed_rate: 80000 };

const azairul: ActiveBookingSnapshot = toSnapshot({
  id: "78ba99f0", reference_code: "PG-HJ5MF", check_in: "2026-10-17", check_out: "2026-10-18", nights: 1,
  status: "confirmed", payment_status: "unpaid", total_amount: "150000.00", paid_amount: "0.00", adults: 1,
  booking_rooms: [{ id: "br-1", room_id: "r-207", room_type_id: SINGLE.id, nightly_rate: 150000, extra_bed_count: 0, room_types: { name: "Single" } }],
});

// ── Pure quote: Azairul ─────────────────────────────────────────────────────
const q = buildRoomChangeQuote({ booking: azairul, newRoomType: DELUXE, newTotal: 230000, available: 1 });
assert.equal(q.ok, true);
assert.equal(q.oldTotal, 150000);
assert.equal(q.newTotal, 230000);
assert.equal(q.extra, 80000);
assert.equal(q.paid, 0);
assert.equal(q.amountDue, 230000, "sisa = total baru − sudah dibayar, bukan selisih tarif");
assert.equal(q.requiredNow, 230000);
assert.equal(q.fullPaymentRequired, true);
const reply = formatRoomChangeQuoteReply(q);
assert.match(reply, /PG-HJ5MF/);
assert.match(reply, /Single → Deluxe/);
assert.match(reply, /Total: Rp150\.000 → Rp230\.000/);
assert.match(reply, /Tambahan biaya: Rp80\.000/);
assert.match(reply, /Sudah dibayar: Rp0/);
assert.match(reply, /Sisa yang perlu ditransfer: Rp230\.000/);
assert.match(reply, /balas \*ya\*/);

// ── Partial paid: 3 malam DP sudah masuk ──────────────────────────────────────
const threeNights = toSnapshot({
  id: "b3", reference_code: "PG-DP3", check_in: "2026-11-01", check_out: "2026-11-04", nights: 3, status: "confirmed",
  payment_status: "partial", total_amount: 690000, paid_amount: 345000,
  booking_rooms: [{ id: "br-3", room_type_id: DELUXE.id, nightly_rate: 230000, extra_bed_count: 0, room_types: { name: "Deluxe" } }],
});
const q3 = buildRoomChangeQuote({ booking: threeNights, newRoomType: { id: "rt-fam", name: "Family Suite 100" }, newTotal: 1500000, available: 1 });
assert.equal(q3.amountDue, 1155000);
assert.equal(q3.requiredNow, 405000); // DP 750.000 − 345.000
assert.equal(q3.fullPaymentRequired, false);
assert.match(formatRoomChangeQuoteReply(q3), /Minimal transfer sekarang \(DP 50%\): Rp405\.000; sisa tagihan total Rp1\.155\.000/);
assert.match(formatRoomChangeQuoteReply(q3), /Sudah dibayar: Rp345\.000/);

// Partial paid 2 malam (DP lama) → wajib lunas sisa.
const twoNights = toSnapshot({
  id: "b2", reference_code: "PG-DP2", check_in: "2026-11-01", check_out: "2026-11-03", status: "confirmed",
  payment_status: "partial", total_amount: 460000, paid_amount: 230000,
  booking_rooms: [{ id: "br-2", room_type_id: DELUXE.id, nightly_rate: 230000, room_types: { name: "Deluxe" } }],
});
assert.equal(twoNights.nights, 2);
const q2 = buildRoomChangeQuote({ booking: twoNights, newRoomType: { id: "rt-gd", name: "Grand Deluxe" }, newTotal: 600000, available: 1 });
assert.equal(q2.amountDue, 370000);
assert.match(formatRoomChangeQuoteReply(q2), /Sisa yang perlu ditransfer: Rp370\.000 \(pemesanan 1–2 malam wajib lunas/);

// Downgrade with overpayment, unavailable, stop-sell, same type.
const qd = buildRoomChangeQuote({ booking: { ...azairul, paidAmount: 230000, totalAmount: 230000, rooms: [{ ...azairul.rooms[0], roomTypeId: DELUXE.id, roomTypeName: "Deluxe" }] }, newRoomType: SINGLE, newTotal: 150000, available: 1 });
assert.equal(qd.refundDue, 80000);
assert.match(formatRoomChangeQuoteReply(qd), /Kelebihan bayar: Rp80\.000/);
assert.equal(buildRoomChangeQuote({ booking: azairul, newRoomType: DELUXE, newTotal: 230000, available: 0 }).reason, "unavailable");
assert.equal(buildRoomChangeQuote({ booking: azairul, newRoomType: DELUXE, newTotal: 230000, available: 1, stopSellDates: ["2026-10-17"] }).reason, "stop_sell");
assert.equal(buildRoomChangeQuote({ booking: azairul, newRoomType: SINGLE, newTotal: 150000, available: 1 }).reason, "same_room_type");
assert.equal(findOverlappingBooking([azairul], "2026-10-17", "2026-10-18")?.referenceCode, "PG-HJ5MF");
assert.equal(findOverlappingBooking([azairul], "2026-10-18", "2026-10-19"), null);
assert.ok(ROOM_CHANGE_INTENT_RE.test("mau ganti ke deluxe kak"));
assert.ok(ROOM_CHANGE_INTENT_RE.test("saya jadi ambil deluxe ya"));
assert.ok(!ROOM_CHANGE_INTENT_RE.test("harga deluxe berapa?"));

// ── Replay Azairul via state machine ─────────────────────────────────────────
function makeDb() {
  const rec = { states: [] as Array<{ state: string; context: any }> };
  const builder = () => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt", "neq", "not"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "t-1" }, error: null });
    b.insert = () => b;
    b.update = () => b;
    b.upsert = () => Promise.resolve({ error: null });
    b.then = (r: any) => r({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: () => builder(),
    rpc: (name: string, args: any) => {
      if (name === "update_booking_state") rec.states.push({ state: args.p_state, context: JSON.parse(JSON.stringify(args.p_context)) });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rec };
}
const ctxOf = (db: any): any => ({ supabaseAdmin: db, supabasePublic: db, rooms: [SINGLE, DELUXE], property: { id: "p" }, today: "2026-10-16", phone: WA });
const rec = (state: StateRecord["state"], context: BookingContext): StateRecord => ({ phone: WA, state, context, updated_at: new Date().toISOString(), slots: {} });

const handoffs: any[] = [];
const writes: any[] = [];
const deps = {
  loadActiveBookings: async () => [azairul],
  computeQuote: async (b: ActiveBookingSnapshot, rt: any) => buildRoomChangeQuote({ booking: b, newRoomType: rt, newTotal: rt.base_rate, available: 1 }),
  createHandoff: async (input: any) => { handoffs.push(input); return { id: "t" }; },
};
const createBookingImpl = (async (args: any) => { writes.push(args); return JSON.stringify({ ok: true, reference_code: "PG-DUP" }); }) as any;

{
  // 22:31 — bot was collecting data for a NEW Deluxe booking on the same dates.
  const { db, rec: r } = makeDb();
  const flowCtx: BookingContext = {
    checkIn: "2026-10-17", checkOut: "2026-10-18", roomId: DELUXE.id, roomName: "Deluxe", adults: 2, children: 0,
    pricePerNight: 230000, totalPrice: 230000, quotedTotal: 230000,
    rooms: [{ roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: 230000 }],
  } as BookingContext;
  const res = await processBookingState(ctxOf(db), WA, "Azairul \n085218818868", rec("COLLECTING_DATA", flowCtx), { roomChange: deps, createBookingImpl });
  assert.equal(res.handled, true);
  assert.match(res.reply ?? "", /PG-HJ5MF/);
  assert.match(res.reply ?? "", /Sisa yang perlu ditransfer: Rp230\.000/);
  assert.doesNotMatch(res.reply ?? "", /Rp80\.000 untuk satu malam/);
  const last = r.states.at(-1)!;
  assert.equal(last.state, "CONFIRMING_BOOKING");
  assert.equal(last.context.pendingRoomChange.amountDue, 230000);

  // Guest replies "ya" → staff handoff, NO new booking.
  const yes = await processBookingState(ctxOf(db), WA, "ya kak", rec("CONFIRMING_BOOKING", last.context), { roomChange: deps, createBookingImpl });
  assert.equal(yes.handled, true);
  assert.equal(writes.length, 0, "tidak boleh ada create_booking kedua");
  assert.equal(handoffs.length, 1);
  assert.match(handoffs[0].triggerMessage, /PG-HJ5MF.*Single → Deluxe.*sisa Rp230\.000/);
  assert.match(yes.reply ?? "", /diteruskan|teruskan/);
  assert.match(yes.reply ?? "", /Rp230\.000/);
  assert.equal(r.states.at(-1)!.state, "IDLE");
}

{
  // Explicit request while IDLE.
  const { db, rec: r } = makeDb();
  const res = await processBookingState(ctxOf(db), WA, "kak saya mau ganti ke deluxe aja", rec("IDLE", {} as BookingContext), { roomChange: deps, createBookingImpl });
  assert.equal(res.handled, true);
  assert.match(res.reply ?? "", /Total: Rp150\.000 → Rp230\.000/);
  // Guest declines.
  const no = await processBookingState(ctxOf(db), WA, "gak jadi kak", rec("CONFIRMING_BOOKING", r.states.at(-1)!.context), { roomChange: deps, createBookingImpl });
  assert.match(no.reply ?? "", /tetap memakai kamar Single/);
  assert.equal(writes.length, 0);
}

{
  // No active booking → normal flow untouched (IDLE → LLM).
  const { db } = makeDb();
  const res = await processBookingState(ctxOf(db), WA, "mau ganti ke deluxe", rec("IDLE", {} as BookingContext), {
    roomChange: { ...deps, loadActiveBookings: async () => [] }, createBookingImpl,
  });
  assert.equal(res.handled, false);
}

// ── Staff tool recalculation ───────────────────────────────────────────────
const staff = recalcBookingAfterRoomChange({
  nights: 1, paid: 0, oldTotal: 150000,
  rows: [{ id: "br-1", nightly_rate: 150000, extra_bed_rate: 80000, extra_bed_count: 0 }],
  changedRowId: "br-1", newNightlyRate: 230000, newExtraBedRate: 80000,
});
assert.deepEqual(
  { t: staff.newTotal, e: staff.extra, d: staff.amountDue, s: staff.paymentStatus },
  { t: 230000, e: 80000, d: 230000, s: "unpaid" },
);
const staffPartial = recalcBookingAfterRoomChange({
  nights: 3, paid: 345000, oldTotal: 690000,
  rows: [{ id: "a", nightly_rate: 230000, extra_bed_rate: 80000, extra_bed_count: 1 }],
  changedRowId: "a", newNightlyRate: 300000, newExtraBedRate: 90000,
});
assert.equal(staffPartial.newTotal, 1170000);
assert.equal(staffPartial.amountDue, 825000);
assert.equal(staffPartial.paymentStatus, "partial");
assert.equal(paymentStatusFor(230000, 230000), "paid");

// ── Wiring ──────────────────────────────────────────────────────────────────
const orch = readFileSync("src/ai/multi-agent-orchestrator.ts", "utf8");
assert.match(orch, /Sudah dibayar: \$\{idr\(Math\.max\(0, ab\.paidAmount \?\? 0\)\)\}/);
assert.match(orch, /TOTAL BARU − SUDAH DIBAYAR/);
assert.match(orch, /ROOM_CHANGE_INTENT_RE\.test\(lastUserMsg\)/);
const tool = readFileSync("src/tools/booking.tool.ts", "utf8");
assert.match(tool, /\.lt\("check_in", checkOut\)\s*\n\s*\.gt\("check_out", checkIn\)/);

console.log("test-room-change-quote: OK");
