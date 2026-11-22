/**
 * Regresi Susilo Yuwono (22 Nov 2026, 6285885881986).
 *
 * Bot tidak pernah menyimpan nama. Ringkasan tetap "Nama: —", dan setiap
 * "Ya" / "Sudah sesuai" ditolak: "ada data yang masih perlu diperbaiki: nama."
 *
 * Pesan 1 (COLLECTING_DATA): tamu menempel template dan mengisi baris bernomor.
 * Pesan 2 (CONFIRMING_BOOKING): tamu menempel ringkasan dengan "• Nama: …"
 * plus Check-in/Check-out yang tidak berubah. Tanggal yang sama bukan koreksi
 * dan tidak boleh mengganti kamar. "Bayar dtempat" = bayar di tempat.
 *
 * Tidak menyentuh database produksi.
 */
import assert from "node:assert/strict";
import { mentionsPayAtCheckin } from "../src/lib/deposit-policy";
import { planStayCorrection } from "../src/ai/state-machine/booking-stay-guard";
import { extractGuestNameFromMessage } from "../src/ai/state-machine/flexible-slot-extractor";
import {
  parseSlotCorrection,
  processBookingState,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";

const TODAY = "2026-11-22";
const WA = "6285885881986";
const CHECK_IN = "2026-11-22";
const CHECK_OUT = "2026-11-23";

const SINGLE = {
  id: "rt-single",
  name: "Single",
  base_rate: 200000,
  capacity: 1,
  extrabed_capacity: 0,
  extrabed_rate: 0,
};
const DELUXE = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: 300000,
  capacity: 2,
  extrabed_capacity: 1,
  extrabed_rate: 80000,
};

const MESSAGE_1 = `Data booking sementara:
Kamar: 1x Single, 2x Deluxe, Check-in: 22 November 2026, Check-out: 23 November 2026, No HP: 6285885881986, Dewasa: 3

Mohon lengkapi data berikut untuk melanjutkan reservasi:
1. Susilo Yuwono`;

const MESSAGE_1_BLANK = `Data booking sementara:
Kamar: 1x Single, 2x Deluxe, Check-in: 22 November 2026, Check-out: 23 November 2026, No HP: 6285885881986, Dewasa: 3

Mohon lengkapi data berikut untuk melanjutkan reservasi:
1. Nama lengkap tamu`;

const MESSAGE_2 = `Data pemesanan sudah lengkap! Berikut ringkasannya:

• Nama: Susilo Yuwono
• No. HP: 6285885881986
• Kamar: 1x Single, 2x Deluxe
• Check-in: 22 November 2026, 14.00
• Check-out: 23 November 2026, 12.00
• Durasi: 1 malam
• Jumlah tamu: 3 orang dewasa
• Harga: Rp300.000/malam
• Total: Rp800.000

Kalau datanya sudah sesuai, saya lanjutkan proses booking dan kirim info pembayarannya ya Kak.

Kalau ada yang ingin dikoreksi, langsung sebutkan saja ya—misalnya tanggal, jumlah tamu, tipe kamar, atau extra bed.`;

function makeDb() {
  const rec = {
    states: [] as Array<{ state: string; context: BookingContext }>,
  };
  const builder = () => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lt", "gt", "not", "or"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "row-1" }, error: null });
    b.insert = () => b;
    b.update = () => {
      const u: any = { eq: () => u, then: (resolve: (value: unknown) => unknown) => resolve({ error: null }) };
      return u;
    };
    b.upsert = async () => ({ error: null });
    b.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: () => builder(),
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
    rooms: [SINGLE, DELUXE],
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

function record(state: StateRecord["state"], context: BookingContext, updatedAt = "2026-11-22T08:00:00.000Z"): StateRecord {
  return { phone: WA, state, context, updated_at: updatedAt, slots: {} };
}

function draft(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    roomId: SINGLE.id,
    roomName: "1x Single, 2x Deluxe",
    pricePerNight: 300000,
    totalPrice: 800000,
    quotedTotal: 800000,
    guestPhone: WA,
    adults: 3,
    children: 0,
    datesConfirmed: true,
    rooms: [
      { roomTypeId: SINGLE.id, roomTypeName: "Single", quantity: 1, pricePerNight: 200000 },
      { roomTypeId: DELUXE.id, roomTypeName: "Deluxe", quantity: 2, pricePerNight: 300000 },
    ],
    ...over,
  };
}

function roomKey(context: BookingContext) {
  return (context.rooms ?? []).map((room) => `${room.roomTypeId}:${room.quantity}`);
}

function assertRoomsUnchanged(context: BookingContext) {
  assert.deepEqual(roomKey(context), [`${SINGLE.id}:1`, `${DELUXE.id}:2`]);
  assert.equal(context.checkIn, CHECK_IN);
  assert.equal(context.checkOut, CHECK_OUT);
}

const CONFIRM_INVITE = /balas\s+"Ya"|Kalau datanya sudah sesuai, saya lanjutkan/i;

// ── Parser nama & tanggal ────────────────────────────────────────────────────
assert.equal(extractGuestNameFromMessage(MESSAGE_1, { awaitingName: true, rooms: [SINGLE, DELUXE] }), "Susilo Yuwono");
assert.equal(extractGuestNameFromMessage(MESSAGE_2, { awaitingName: true, rooms: [SINGLE, DELUXE] }), "Susilo Yuwono");
assert.equal(extractGuestNameFromMessage("Data booking sementara:", { awaitingName: true }), null);
assert.equal(
  extractGuestNameFromMessage("Mohon lengkapi data berikut untuk melanjutkan reservasi:", { awaitingName: true }),
  null,
);
assert.equal(extractGuestNameFromMessage("1. Nama lengkap tamu", { awaitingName: true }), null);
assert.equal(extractGuestNameFromMessage(MESSAGE_1_BLANK, { awaitingName: true, rooms: [SINGLE, DELUXE] }), null);
assert.equal(extractGuestNameFromMessage("1. Deluxe", { awaitingName: true, rooms: [SINGLE, DELUXE] }), null);
assert.equal(extractGuestNameFromMessage("• Nama: Susilo Yuwono", { awaitingName: true }), "Susilo Yuwono");

assert.equal(
  planStayCorrection(MESSAGE_1, { checkIn: CHECK_IN, checkOut: CHECK_OUT }, TODAY),
  null,
  "tanggal yang sama dengan draft bukan koreksi",
);
assert.equal(
  planStayCorrection(MESSAGE_2, { checkIn: CHECK_IN, checkOut: CHECK_OUT }, TODAY),
  null,
);
{
  const changed = planStayCorrection(
    "Check-in: 24 November 2026, Check-out: 25 November 2026",
    { checkIn: CHECK_IN, checkOut: CHECK_OUT },
    TODAY,
  );
  assert.equal(changed?.checkIn, "2026-11-24");
  assert.equal(changed?.checkOut, "2026-11-25");
}

{
  const parsed = parseSlotCorrection(MESSAGE_2, [SINGLE, DELUXE]);
  assert.equal(parsed.patch.guestName, "Susilo Yuwono");
  assert.equal(parsed.changed, true);
  const blank = parseSlotCorrection("1. Nama lengkap tamu\nData booking sementara:", [SINGLE, DELUXE]);
  assert.equal(blank.patch.guestName, undefined);
}

assert.ok(mentionsPayAtCheckin("Bayar dtempat ya kak"));
assert.ok(mentionsPayAtCheckin("bayar dtempat"));
assert.ok(mentionsPayAtCheckin("bayar ditempat"));
assert.ok(mentionsPayAtCheckin("bayar di tempat ya kak"));
assert.ok(!mentionsPayAtCheckin("mau transfer saja"));
assert.ok(!mentionsPayAtCheckin("Data booking sementara:"));

function writer() {
  const calls: Array<Record<string, unknown>> = [];
  const impl = async (args: Record<string, unknown>) => {
    calls.push(args);
    return JSON.stringify({ ok: true, reference_code: "PG-SUSILO", total: 800000 });
  };
  return { calls, impl };
}

async function main() {
  // Pesan 1: nama dari baris bernomor, ringkasan menampilkan nama, "Ya" membuat booking.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(ctxOf(db) as any, WA, MESSAGE_1, record("COLLECTING_DATA", draft()), {
      createBookingImpl: w.impl as any,
    });
    assert.equal(w.calls.length, 0, "tempelan template belum membuat booking");
    const saved = rec.states.at(-1)!;
    assert.equal(saved.context.guestName, "Susilo Yuwono");
    assert.equal(saved.state, "CONFIRMING_BOOKING");
    assertRoomsUnchanged(saved.context);
    assert.match(reply.reply ?? "", /Nama:\s*Susilo Yuwono/);
    assert.doesNotMatch(reply.reply ?? "", /Nama:\s*—/);

    const yes = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Ya",
      record("CONFIRMING_BOOKING", saved.context, "2026-11-22T08:05:00.000Z"),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 1, "Ya setelah nama lengkap masuk jalur createBooking");
    assert.equal(w.calls[0].full_name, "Susilo Yuwono");
    assert.equal(w.calls[0].check_in, CHECK_IN);
    assert.equal(w.calls[0].check_out, CHECK_OUT);
    assert.match(yes.reply ?? "", /PG-SUSILO/);
  }

  // Pesan 2, tiga kali: nama terisi, tanggal & kamar tidak di-reset. "Sudah sesuai" membuat booking.
  {
    const { db, rec } = makeDb();
    const w = writer();
    let context = draft();
    for (let i = 0; i < 3; i++) {
      const reply = await processBookingState(
        ctxOf(db) as any,
        WA,
        MESSAGE_2,
        record("CONFIRMING_BOOKING", context, `2026-11-22T08:1${i}:00.000Z`),
        { createBookingImpl: w.impl as any },
      );
      assert.equal(w.calls.length, 0, `tempelan ke-${i + 1} tidak membuat booking`);
      const saved = rec.states.at(-1)!;
      assert.equal(saved.context.guestName, "Susilo Yuwono");
      assert.equal(saved.state, "CONFIRMING_BOOKING");
      assertRoomsUnchanged(saved.context);
      assert.match(reply.reply ?? "", /Nama:\s*Susilo Yuwono/);
      assert.doesNotMatch(reply.reply ?? "", /Nama:\s*—/);
      context = saved.context;
    }
    const yes = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Sudah sesuai",
      record("CONFIRMING_BOOKING", context, "2026-11-22T08:20:00.000Z"),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0].full_name, "Susilo Yuwono");
    assert.match(yes.reply ?? "", /PG-SUSILO/);
  }

  // Tempelan ulang saat nama SUDAH ada: tanggal sama tidak membajak kamar/tanggal.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      MESSAGE_2,
      record("CONFIRMING_BOOKING", draft({ guestName: "Susilo Yuwono" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0);
    const saved = rec.states.at(-1)!;
    assert.equal(saved.context.guestName, "Susilo Yuwono");
    assert.equal(saved.state, "CONFIRMING_BOOKING");
    assertRoomsUnchanged(saved.context);
    assert.match(reply.reply ?? "", /Nama:\s*Susilo Yuwono/);
  }

  // Template tanpa nama tidak menjadi nama dan tidak masuk ringkasan "balas Ya".
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      MESSAGE_1_BLANK,
      record("COLLECTING_DATA", draft()),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0);
    const saved = rec.states.at(-1)!;
    assert.equal(saved.state, "COLLECTING_DATA");
    assert.ok(!saved.context.guestName, "template bot tidak tersimpan sebagai nama");
    assert.notEqual(saved.context.guestName, "Data booking sementara");
    assert.notEqual(saved.context.guestName, "Mohon lengkapi data");
    assert.notEqual(saved.context.guestName, "Nama lengkap tamu");
    assert.notEqual(saved.context.guestName, "lengkap tamu");
    assertRoomsUnchanged(saved.context);
    assert.match(reply.reply ?? "", /Nama lengkap tamu/);
    assert.doesNotMatch(reply.reply ?? "", CONFIRM_INVITE);
    assert.doesNotMatch(reply.reply ?? "", /Sebelum saya buat invoice/);
  }

  // "Ya" saat nama masih kosong: minta nama, jangan gerbang invoice, jangan createBooking.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Ya",
      record("CONFIRMING_BOOKING", draft({ guestName: undefined })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0);
    assert.match(reply.reply ?? "", /Nama lengkap tamu/);
    assert.doesNotMatch(reply.reply ?? "", /Sebelum saya buat invoice/);
    assert.doesNotMatch(reply.reply ?? "", CONFIRM_INVITE);
    assert.equal(rec.states.at(-1)!.state, "COLLECTING_DATA");
    assert.ok(!rec.states.at(-1)!.context.guestName);
  }

  // bookingCode yang sudah ada tidak membuat booking kedua.
  {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      "Ya",
      record("CONFIRMING_BOOKING", draft({ guestName: "Susilo Yuwono", bookingCode: "PG-ADA" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0, "bookingCode menghalangi createBooking ganda");
    assert.equal(rec.states.at(-1)!.state, "PAYMENT_PENDING");
    assert.equal(rec.states.at(-1)!.context.bookingCode, "PG-ADA");
    assert.equal(reply.handled, false);

    const pasted = await processBookingState(
      ctxOf(db) as any,
      WA,
      MESSAGE_2,
      record("CONFIRMING_BOOKING", draft({ guestName: "Susilo Yuwono", bookingCode: "PG-ADA" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0);
    assert.equal(pasted.handled, false);
  }

  // Bayar di tempat, termasuk typo "dtempat" / "ditempat". Bukan createBooking.
  for (const message of ["Bayar dtempat ya kak", "bayar ditempat", "bayar dtempat"]) {
    const { db, rec } = makeDb();
    const w = writer();
    const reply = await processBookingState(
      ctxOf(db) as any,
      WA,
      message,
      record("CONFIRMING_BOOKING", draft({ guestName: "Susilo Yuwono" })),
      { createBookingImpl: w.impl as any },
    );
    assert.equal(w.calls.length, 0, message);
    assert.equal(rec.states.at(-1)!.context.paymentType, "onsite", message);
    assert.equal(rec.states.at(-1)!.context.guestName, "Susilo Yuwono");
    assertRoomsUnchanged(rec.states.at(-1)!.context);
    assert.match(reply.reply ?? "", /bayar di tempat/i, message);
  }

  console.log("susilo name capture: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
