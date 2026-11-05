/**
 * Regresi Syahrul Alwi (5 Nov 2026, 6281215383779).
 *
 * Alur live: availability → Single → brosur → "saya ambil yg single… dibantu
 * pembayarannya" → nama+HP → ringkasan CONFIRMING_BOOKING → admin manual
 * "sudah kita terima pembayarannya" (admin_inbox) → tamu "sudah sesuai" →
 * "terima kasih". Booking TIDAK dibuat; state macet CONFIRMING_BOOKING.
 *
 * Akar (verified di DB + kode):
 *   1. "sudah sesuai" tidak match CONFIRM_PATTERN lama.
 *   2. Pesan admin memicu staff silence 1 jam (ai_paused_until), jadi bot
 *      tidak pernah memproses "sudah sesuai".
 *   3. Badge intent webhook "Pembayaran" untuk "ambil yg single… pembayaran"
 *      (routing AI tetap masuk booking, tapi label/confidence menyesatkan).
 *   4. context.roomId = room_types.id (bukan rooms.id) — by design.
 */
import assert from "node:assert/strict";
import {
  isBookingConfirmationMessage,
  processBookingState,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";
import { isOfferAcceptance } from "../src/ai/state-machine/offer-acceptance";
import { classifyMessageIntent } from "../src/webhook/intent-classifier";
import { isStaffOutboundMetadata, staffSilenceUntil, STAFF_REPLY_SILENCE_MS } from "../src/services/wa-autoreply/staff-silence";
import { createBooking } from "../src/tools/booking.tool";

const WA = "6281215383779";
const SINGLE = {
  id: "10000000-0000-0000-0000-000000000002",
  name: "Single",
  base_rate: 157500,
  capacity: 1,
  bed_type: null,
  description: null,
  extrabed_capacity: 0,
  extrabed_rate: 0,
};

function makeDb() {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
    upserts: [] as any[],
    updates: [] as any[],
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
    b.update = (patch: any) => {
      rec.updates.push({ table, patch });
      const u: any = { eq: () => u, then: (r: any) => r({ error: null }) };
      return u;
    };
    b.then = (r: any) => r({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: (t: string) => builder(t),
    rpc: (name: string, args: any) => {
      if (name === "update_booking_state") {
        rec.states.push({ state: args.p_state, context: JSON.parse(JSON.stringify(args.p_context)) });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rec };
}

function makeCtx(db: any): any {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms: [SINGLE],
    property: { id: "prop-1", bank_account: "BCA 123" },
    today: "2026-11-05",
    phone: WA,
    llmConfig: undefined,
  };
}

function syahrulContext(over: Partial<BookingContext> = {}): BookingContext {
  return {
    adults: 1,
    children: 0,
    checkIn: "2026-11-06",
    checkOut: "2026-11-08",
    datesConfirmed: true,
    guestName: "syahrul alwi",
    guestPhone: WA,
    roomId: SINGLE.id,
    roomName: "Single",
    pricePerNight: 157500,
    totalPrice: 315000,
    quotedTotal: 315000,
    rooms: [{ roomTypeId: SINGLE.id, roomTypeName: "Single", quantity: 1, pricePerNight: 157500 }],
    lastSummary: {
      adults: 1,
      children: 0,
      checkIn: "2026-11-06",
      checkOut: "2026-11-08",
      rooms: [{ roomTypeId: SINGLE.id, quantity: 1 }],
      total: 315000,
    },
    ...over,
  };
}

function record(state: StateRecord["state"], context: BookingContext): StateRecord {
  return { phone: WA, state, context, updated_at: "2026-11-05T13:32:09.030Z", slots: {} };
}

function makeFakeWriter() {
  const calls: any[] = [];
  const impl = (async (args: any, ctx: any) => {
    calls.push({ args, ctx });
    return JSON.stringify({
      ok: true,
      reference_code: "PG-H4SYA",
      total: 315000,
      guest: { full_name: "syahrul alwi" },
    });
  }) as typeof createBooking;
  return { impl, calls };
}

async function main() {
  // A1. "sudah sesuai" & sinonim = konfirmasi (bug utama pola).
  for (const msg of [
    "sudah sesuai",
    "Sudah sesuai",
    "sesuai",
    "udah sesuai",
    "ya sudah sesuai",
    "oke sudah sesuai",
    "sudah benar",
    "iya benar",
    "setuju",
    "lanjut",
    "ok",
    "ya",
  ]) {
    assert.equal(isBookingConfirmationMessage(msg), true, `harus konfirmasi: ${msg}`);
  }
  for (const msg of ["terima kasih", "makasih", "berapa harganya?", "ubah tanggal"]) {
    assert.equal(isBookingConfirmationMessage(msg), false, `bukan konfirmasi: ${msg}`);
  }

  // A2. CONFIRMING_BOOKING + "sudah sesuai" → create booking + invoice follow-up.
  {
    const { db, rec } = makeDb();
    const w = makeFakeWriter();
    const res = await processBookingState(
      makeCtx(db),
      WA,
      "sudah sesuai",
      record("CONFIRMING_BOOKING", syahrulContext()),
      { createBookingImpl: w.impl },
    );
    assert.equal(w.calls.length, 1, "sudah sesuai harus menulis booking");
    assert.equal(res.handled, true);
    assert.equal(res.followUp, "send_invoice");
    assert.match(res.reply ?? "", /PG-H4SYA/);
    assert.equal(rec.states.at(-1)?.state, "PAYMENT_PENDING");
    assert.equal(rec.states.at(-1)?.context.bookingCode, "PG-H4SYA");
    assert.equal(w.calls[0].args.room_type, "Single");
    assert.equal(w.calls[0].args.check_in, "2026-11-06");
    assert.equal(w.calls[0].args.check_out, "2026-11-08");
    assert.equal(w.calls[0].args.expected_total, 315000);
    // roomId di context = room_type_id Single; create path memakai nama + rooms[].roomTypeId.
    assert.equal(syahrulContext().roomId, SINGLE.id);
    assert.equal(w.calls[0].args.rooms?.[0]?.roomTypeId ?? w.calls[0].args.room_type, w.calls[0].args.rooms?.[0]?.roomTypeId ? SINGLE.id : "Single");
  }

  // A3. "sesuai" murni juga menulis.
  {
    const { db } = makeDb();
    const w = makeFakeWriter();
    const res = await processBookingState(
      makeCtx(db),
      WA,
      "sesuai",
      record("CONFIRMING_BOOKING", syahrulContext()),
      { createBookingImpl: w.impl },
    );
    assert.equal(w.calls.length, 1);
    assert.equal(res.followUp, "send_invoice");
  }

  // A4. "terima kasih" TIDAK membatalkan / TIDAK mengosongkan state.
  {
    const { db, rec } = makeDb();
    const w = makeFakeWriter();
    const res = await processBookingState(
      makeCtx(db),
      WA,
      "terima kasih",
      record("CONFIRMING_BOOKING", syahrulContext()),
      { createBookingImpl: w.impl },
    );
    assert.equal(w.calls.length, 0, "terima kasih tidak menulis booking");
    assert.equal(res.handled, true);
    assert.doesNotMatch(res.reply ?? "", /batalkan|dibatalkan/i);
    assert.match(res.reply ?? "", /sudah sesuai|Ya/i);
    // State masih CONFIRMING (TTL refresh) dengan data utuh.
    const last = rec.states.at(-1);
    assert.ok(last);
    assert.equal(last!.context.guestName, "syahrul alwi");
    assert.equal(last!.context.roomId, SINGLE.id);
  }

  // B. "saya ambil yg single… pembayarannya" → Booking (bukan Pembayaran) + offer acceptance.
  {
    const msg = "saya ambil yg single ya min, boleh dibantu untuk pembayarannya";
    assert.equal(classifyMessageIntent(msg), "Booking", "badge intent harus Booking, bukan Pembayaran");
    assert.ok(isOfferAcceptance(msg), "harus dianggap niat ambil/proses kamar");
    // FAQ pembayaran murni tetap Pembayaran.
    assert.equal(classifyMessageIntent("minta norek untuk transfer"), "Pembayaran");
  }

  // D. Admin inbox message = staff outbound → silence 1 jam (penyebab stall live).
  {
    const adminAt = Date.parse("2026-11-05T13:55:01.294Z");
    const meta = { source: "admin_inbox" };
    assert.equal(isStaffOutboundMetadata(meta), true, "admin_inbox dihitung balasan staf");
    const until = staffSilenceUntil(
      [{ direction: "out", sent_at: new Date(adminAt).toISOString(), metadata: meta }],
      adminAt + 5_000, // saat tamu kirim "sudah sesuai"
    );
    assert.ok(until, "silence aktif saat tamu konfirmasi");
    assert.equal(Date.parse(until!), adminAt + STAFF_REPLY_SILENCE_MS);
    // Bot outbound tidak memicu silence.
    assert.equal(
      staffSilenceUntil(
        [{ direction: "out", sent_at: new Date(adminAt).toISOString(), metadata: { agent: "Front Office Agent" } }],
        adminAt + 5_000,
      ),
      null,
    );
  }

  console.log("test-syahrul-confirm-flow: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
