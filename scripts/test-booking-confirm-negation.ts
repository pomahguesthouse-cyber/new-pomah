/**
 * Regresi negasi/koreksi vs konfirmasi booking (7 Nov 2026).
 * Harness disalin dari test-syahrul-confirm-flow.
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
  isBookingNegationOrCorrection,
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


async function run(msg: string, ctxOver: Partial<BookingContext> = {}) {
  const { db, rec } = makeDb();
  const w = makeFakeWriter();
  const res = await processBookingState(makeCtx(db), WA, msg, record("CONFIRMING_BOOKING", syahrulContext(ctxOver)), {
    createBookingImpl: w.impl,
  });
  return { res, rec, w };
}

async function main() {
  const negations = [
    "belum sesuai kak", "belum sesuai", "tidak sesuai", "gak sesuai", "nggak sesuai kak", "bukan itu kak",
    "salah kak", "kurang sesuai", "ok tanggalnya 22 Juni", "iya, jumlah tamu 5", "iya jumlah tamu 5 kak",
    "ya tapi ganti deluxe", "oke tapi 2 kamar", "sesuai, tapi tanggal 10", "ya check in tgl 12",
    "ok nama saya budi", "no", "ya 2 malam",
  ];
  for (const m of negations) {
    assert.equal(isBookingConfirmationMessage(m), false, `bukan persetujuan: ${m}`);
    assert.equal(isBookingNegationOrCorrection(m), true, `negasi/koreksi: ${m}`);
  }
  const approvals = [
    "ya", "iya", "ok", "oke kak", "sudah sesuai", "sudah sesuai kak", "sesuai", "ya sudah sesuai", "betul kak",
    "iya benar", "setuju", "lanjut", "lanjutkan kak", "sip", "ok, lanjut", "Ya, sudah benar 🙏", "oke terima kasih",
  ];
  for (const m of approvals) {
    assert.equal(isBookingConfirmationMessage(m), true, `persetujuan: ${m}`);
    assert.equal(isBookingNegationOrCorrection(m), false, `bukan koreksi: ${m}`);
  }
  for (const m of ["halo", "terima kasih", "berapa harganya?", "ya?", "lokasinya dimana", "wifi ada"]) {
    assert.equal(isBookingConfirmationMessage(m), false, `teks lain bukan persetujuan: ${m}`);
  }

  for (const m of ["belum sesuai kak", "tidak sesuai", "salah kak", "kurang sesuai"]) {
    const { res, w, rec } = await run(m);
    assert.equal(w.calls.length, 0, `tidak boleh buat booking: ${m}`);
    assert.notEqual(res.followUp, "send_invoice");
    assert.ok(!rec.states.some((s) => s.state === "PAYMENT_PENDING"), `tidak ke PAYMENT_PENDING: ${m}`);
    assert.match(res.reply ?? "", /belum saya proses|diperbaiki/i, m);
  }

  {
    const { res, w, rec } = await run("iya, jumlah tamu 5");
    assert.equal(w.calls.length, 0, "koreksi tamu tidak boleh menulis booking");
    assert.notEqual(res.followUp, "send_invoice");
    assert.ok(!rec.states.some((s) => s.state === "PAYMENT_PENDING"));
  }

  for (const m of ["ok tanggalnya 22 Juni", "ya check in tgl 7 nov"]) {
    const { res, w, rec } = await run(m);
    assert.equal(w.calls.length, 0, `koreksi tanggal tidak boleh menulis: ${m}`);
    assert.notEqual(res.followUp, "send_invoice");
    assert.ok(!rec.states.some((s) => s.state === "PAYMENT_PENDING"), m);
  }

  {
    const { res, w } = await run("ya tapi ganti 2 kamar");
    assert.equal(w.calls.length, 0);
    assert.notEqual(res.followUp, "send_invoice");
  }

  for (const m of ["halo", "wifi ada"]) {
    const { w, res } = await run(m);
    assert.equal(w.calls.length, 0, m);
    assert.notEqual(res.followUp, "send_invoice");
  }

  // Data basi: ringkasan terakhir != draft -> walau "ya", tidak write.
  {
    const { w, res } = await run("ya", { adults: 3 });
    assert.equal(w.calls.length, 0, "ringkasan basi tidak boleh ditulis");
    assert.notEqual(res.followUp, "send_invoice");
  }

  for (const m of ["ya", "sudah sesuai kak", "oke, lanjut"]) {
    const { res, w } = await run(m);
    assert.equal(w.calls.length, 1, `persetujuan murni harus write: ${m}`);
    assert.equal(res.followUp, "send_invoice");
    assert.equal(w.calls[0].args.adults, 1);
    assert.equal(w.calls[0].args.check_in, "2026-11-06");
  }

  console.log("test-booking-confirm-negation: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
