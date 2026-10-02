/**
 * Regresi aturan dialog pemesanan WhatsApp (konfirmasi sekali + write tunggal).
 *
 * Tanpa jaringan/DB: Supabase & `create_booking` diganti fake. Yang dijamin:
 *   1. Konfirmasi SEKALI → satu write ke PMS, tanpa minta data ulang.
 *   2. Idempoten: "ya" ganda / diproses bersamaan → satu booking, kunci sama.
 *   3. Write gagal (error maupun exception) → "belum tercatat", tawarkan coba
 *      lagi / staf, TIDAK mengklaim sukses, kegagalan dicatat (log + tiket).
 *   4. Draft disimpan di Supabase SEBELUM write; completed bila sukses, failed bila gagal.
 *   5. Nomor telepon: default nomor WA thread; nomor lain wajib dikonfirmasi
 *      aktif WhatsApp; format 62xxxx.
 *   6. Total: satu sumber integer rupiah; total terkonfirmasi != hitungan server
 *      → write dihentikan & tamu konfirmasi ulang dengan angka sistem.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBookingWriteFailureReply,
  buildConfirmIdempotencyKey,
  buildDraftKey,
  normalizeWaNumber,
  processBookingState,
  proposeGuestPhone,
  type BookingContext,
  type StateRecord,
} from "../src/ai/state-machine/booking-machine";
import { computeGrandTotal, toRupiah, totalsMatch } from "../src/lib/booking-total";
import { createBooking } from "../src/tools/booking.tool";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WA = "6281234567890";
const ROOM = {
  id: "rt-deluxe",
  name: "Deluxe",
  base_rate: 350000,
  capacity: 2,
  bed_type: null,
  description: null,
  extrabed_capacity: 1,
  extrabed_rate: 80000,
};

// ─── Fake Supabase ──────────────────────────────────────────────────────────

function makeDb(tables: Record<string, any[]> = {}) {
  const log: string[] = []; // urutan kejadian lintas komponen
  const rec = {
    upserts: [] as any[],
    updates: [] as any[],
    inserts: [] as any[],
    states: [] as Array<{ state: string; context: BookingContext }>,
  };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "gte", "lt", "gt", "not"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "ticket-1" }, error: null });
    b.insert = (row: any) => {
      rec.inserts.push({ table, row });
      log.push(`insert:${table}`);
      return b;
    };
    b.upsert = (row: any, opts: any) => {
      rec.upserts.push({ table, row, opts });
      log.push(`upsert:${table}:${row.status}`);
      return Promise.resolve({ error: null });
    };
    b.update = (patch: any) => {
      rec.updates.push({ table, patch });
      log.push(`update:${table}:${patch.status ?? ""}`);
      const u: any = { eq: () => u, then: (r: any) => r({ error: null }) };
      return u;
    };
    b.then = (r: any) => r({ data: tables[table] ?? [], error: null });
    return b;
  };
  const db: any = {
    from: (t: string) => builder(t),
    rpc: (name: string, args: any) => {
      if (name === "update_booking_state") rec.states.push({ state: args.p_state, context: JSON.parse(JSON.stringify(args.p_context)) });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rec, log };
}

function makeCtx(db: any): any {
  return {
    supabaseAdmin: db,
    supabasePublic: db,
    rooms: [ROOM],
    property: { id: "prop-1" },
    today: "2026-10-02",
    phone: WA,
    llmConfig: undefined,
  };
}

function confirmingContext(over: Partial<BookingContext> = {}): BookingContext {
  return {
    checkIn: "2026-11-10",
    checkOut: "2026-11-12",
    roomId: ROOM.id,
    roomName: "Deluxe",
    pricePerNight: 350000,
    totalPrice: 700000,
    quotedTotal: 700000,
    guestName: "Budi Santoso",
    guestPhone: WA,
    adults: 2,
    children: 0,
    rooms: [{ roomTypeId: ROOM.id, roomTypeName: "Deluxe", quantity: 1, pricePerNight: 350000 }],
    ...over,
  };
}

function record(state: StateRecord["state"], context: BookingContext, updatedAt = "2026-10-02T10:00:00.000Z"): StateRecord {
  return { phone: WA, state, context, updated_at: updatedAt, slots: {} };
}

const okResult = (code = "PG-AAAA1", total = 700000) =>
  JSON.stringify({ ok: true, reference_code: code, total, guest: { full_name: "Budi Santoso" } });

/** create_booking palsu yang meniru unique index idempotency_key. */
function makeFakeWriter(opts: { fail?: "error" | "throw" | "mismatch" | null; serverTotal?: number } = {}) {
  const calls: Array<{ args: any; ctx: any }> = [];
  const byKey = new Map<string, string>();
  let counter = 0;
  const impl = (async (args: any, ctx: any) => {
    calls.push({ args, ctx });
    if (opts.fail === "throw") throw new Error("fetch failed: ECONNRESET");
    if (opts.fail === "error") return JSON.stringify({ ok: false, error: "Gagal membuat booking: connection timeout (pg 57014)" });
    if (opts.fail === "mismatch") {
      return JSON.stringify({ ok: false, total_mismatch: true, confirmed_total: args.expected_total, server_total: opts.serverTotal });
    }
    const key = ctx.idempotencyKey as string;
    if (key && byKey.has(key)) return okResult(byKey.get(key));
    const code = `PG-${String(++counter).padStart(5, "0")}`;
    if (key) byKey.set(key, code);
    return okResult(code);
  }) as typeof createBooking;
  return { impl, calls, bookingsCreated: () => new Set(byKey.values()).size };
}

async function main() {
  // ── 1. Konfirmasi sekali → write tunggal, tanpa minta data ulang ──────────
  {
    const { db, rec, log } = makeDb();
    const w = makeFakeWriter();
    const res = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext()), {
      createBookingImpl: w.impl,
    });
    assert.equal(w.calls.length, 1, "tepat satu write create_booking");
    assert.equal(res.handled, true);
    assert.match(res.reply ?? "", /PG-00001/, "balasan memuat kode booking dari sistem");
    assert.equal(res.followUp, "send_invoice");
    assert.doesNotMatch(
      res.reply ?? "",
      /nama lengkap|ketikkan|lengkapi|tanggal check-in|tipe kamar|nomor hp/i,
      "tidak boleh meminta ulang data yang sudah dikonfirmasi",
    );
    const call = w.calls[0];
    assert.equal(call.args.full_name, "Budi Santoso");
    assert.equal(call.args.phone, WA);
    assert.equal(call.args.room_type, "Deluxe");
    assert.equal(call.args.check_in, "2026-11-10");
    assert.equal(call.args.check_out, "2026-11-12");
    assert.equal(call.args.expected_total, 700000, "total terkonfirmasi diteruskan ke server");
    assert.match(String(call.ctx.idempotencyKey), /^wa_confirm:/, "write memakai kunci idempotensi per-konfirmasi");
    assert.equal(rec.states.at(-1)?.state, "PAYMENT_PENDING");
    assert.equal(rec.states.at(-1)?.context.bookingCode, "PG-00001");

    // Draft disimpan SEBELUM write dan ditandai completed sesudahnya.
    assert.equal(rec.upserts.length, 1);
    assert.equal(rec.upserts[0].table, "booking_drafts");
    assert.equal(rec.upserts[0].row.status, "draft");
    assert.equal(rec.upserts[0].row.guest_name, "Budi Santoso");
    assert.equal(rec.upserts[0].row.quoted_total, 700000);
    assert.equal(rec.upserts[0].opts.onConflict, "idempotency_key");
    const draftIdx = log.indexOf("upsert:booking_drafts:draft");
    const doneIdx = log.indexOf("update:booking_drafts:completed");
    assert.ok(draftIdx >= 0 && doneIdx > draftIdx, "draft → completed berurutan");
    const done = rec.updates.find((u) => u.table === "booking_drafts");
    assert.equal(done.patch.booking_code, "PG-00001");
  }

  // ── 2. "ya" kedua tidak menulis ulang & tidak minta data ──────────────────
  {
    const { db } = makeDb();
    const w = makeFakeWriter();
    const ctxPaid = confirmingContext({ bookingCode: "PG-00001" });
    const r1 = await processBookingState(makeCtx(db), WA, "ya", record("PAYMENT_PENDING", ctxPaid), { createBookingImpl: w.impl });
    assert.equal(r1.handled, false, "PAYMENT_PENDING menyerahkan ke Finance, tidak menulis ulang");
    const r2 = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", ctxPaid), { createBookingImpl: w.impl });
    assert.equal(r2.handled, false);
    assert.equal(w.calls.length, 0, "booking yang sudah punya kode tidak ditulis lagi");
  }

  // ── 3. Idempoten: dua "ya" bersamaan membaca state sama → satu booking ────
  {
    const { db } = makeDb();
    const w = makeFakeWriter();
    const rec1 = record("CONFIRMING_BOOKING", confirmingContext());
    const rec2 = record("CONFIRMING_BOOKING", confirmingContext());
    const [a, b] = await Promise.all([
      processBookingState(makeCtx(db), WA, "ya", rec1, { createBookingImpl: w.impl }),
      processBookingState(makeCtx(db), WA, "iya kak", rec2, { createBookingImpl: w.impl }),
    ]);
    assert.equal(w.calls.length, 2);
    assert.equal(w.calls[0].ctx.idempotencyKey, w.calls[1].ctx.idempotencyKey, "kunci idempotensi identik");
    assert.equal(w.bookingsCreated(), 1, "hanya satu booking tercipta");
    assert.match(a.reply ?? "", /PG-00001/);
    assert.match(b.reply ?? "", /PG-00001/);

    const base = confirmingContext();
    const k1 = buildConfirmIdempotencyKey(WA, base, "t1");
    assert.equal(k1, buildConfirmIdempotencyKey(WA, { ...base }, "t1"));
    assert.notEqual(k1, buildConfirmIdempotencyKey(WA, { ...base, checkOut: "2026-11-13" }, "t1"), "isi beda → kunci beda");
    assert.notEqual(k1, buildConfirmIdempotencyKey(WA, base, "t2"), "state diperbarui → kunci baru");
    assert.equal(buildDraftKey(WA, base), buildDraftKey(WA, { ...base }), "kunci draft stabil untuk percobaan ulang");
  }

  // ── 4. Write gagal (error & exception) → 'belum tercatat', tidak klaim sukses ──
  for (const mode of ["error", "throw"] as const) {
    const { db, rec, log } = makeDb();
    const w = makeFakeWriter({ fail: mode });
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
    let res;
    try {
      res = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext()), {
        createBookingImpl: w.impl,
      });
    } finally {
      console.error = origErr;
    }
    const reply = res.reply ?? "";
    assert.equal(w.calls.length, 1, `[${mode}] tidak ada write berulang otomatis`);
    assert.match(reply, /belum tercatat/i, `[${mode}] harus jelas pemesanan belum tercatat`);
    assert.match(reply, /coba catat lagi|"Ya"/i, `[${mode}] tawarkan coba lagi`);
    assert.match(reply, /staf/i, `[${mode}] tawarkan bantuan staf`);
    assert.match(reply, /tidak perlu mengisi ulang/i, `[${mode}] data tidak diminta ulang`);
    assert.doesNotMatch(reply, /berhasil dibuat|PG-\d+|kode booking:/i, `[${mode}] tidak boleh klaim sukses`);
    assert.doesNotMatch(reply, /timeout|ECONNRESET|pg 57014|fetch failed/i, `[${mode}] detail teknis tidak bocor ke tamu`);
    assert.equal(res.followUp, undefined, `[${mode}] tidak mengirim invoice`);
    // State tetap CONFIRMING dengan data utuh → "ya" berikutnya = coba lagi.
    const last = rec.states.at(-1)!;
    assert.equal(last.state, "CONFIRMING_BOOKING");
    assert.equal(last.context.guestName, "Budi Santoso");
    assert.ok(last.context.writeFailedAt, "kegagalan dicatat di state");
    assert.equal(last.context.bookingCode, undefined);
    // Log kegagalan + tiket handoff untuk staf + draft ditandai failed.
    assert.ok(errors.some((e) => /\[BookingWrite\] GAGAL/.test(e)), `[${mode}] kegagalan di-log`);
    const ticket = rec.inserts.find((i) => i.table === "handoff_tickets");
    assert.ok(ticket, `[${mode}] tiket handoff dibuat untuk staf`);
    assert.equal(ticket.row.frustration_kind, "booking_write_failed");
    const failed = rec.updates.find((u) => u.table === "booking_drafts");
    assert.equal(failed.patch.status, "failed", `[${mode}] draft dibiarkan 'failed' untuk staf`);
    assert.ok(!log.includes("update:booking_drafts:completed"));
  }

  // Kegagalan yang bisa ditindaklanjuti tamu (kamar penuh) → alasan disebut, tetap 'belum tercatat'.
  {
    const { db } = makeDb();
    const impl = (async () => JSON.stringify({ ok: false, error: "Deluxe sudah penuh untuk tanggal tersebut." })) as typeof createBooking;
    const res = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext()), { createBookingImpl: impl });
    assert.match(res.reply ?? "", /belum tercatat/i);
    assert.match(res.reply ?? "", /Deluxe sudah penuh/);
  }
  // Respons tool tanpa kode booking BUKAN sukses.
  {
    const { db } = makeDb();
    const impl = (async () => JSON.stringify({ ok: true })) as typeof createBooking;
    const res = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext()), { createBookingImpl: impl });
    assert.match(res.reply ?? "", /belum tercatat/i);
  }
  {
    const reply = buildBookingWriteFailureReply({ staffNotified: false });
    assert.match(reply, /belum tercatat/i);
    assert.match(reply, /Admin/);
  }

  // ── 4b. Coba lagi setelah gagal: tanpa data ulang, sukses → draft completed, tiket ditutup ──
  {
    const { db, rec } = makeDb();
    const failing = makeFakeWriter({ fail: "error" });
    const origErr = console.error;
    console.error = () => {};
    const first = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext()), { createBookingImpl: failing.impl });
    console.error = origErr;
    assert.match(first.reply ?? "", /belum tercatat/i);
    const afterFail = rec.states.at(-1)!;
    const good = makeFakeWriter();
    const retry = await processBookingState(
      makeCtx(db),
      WA,
      "ya",
      record("CONFIRMING_BOOKING", afterFail.context, "2026-10-02T10:05:00.000Z"),
      { createBookingImpl: good.impl },
    );
    assert.equal(good.calls.length, 1);
    assert.match(retry.reply ?? "", /PG-00001/);
    assert.notEqual(failing.calls[0].ctx.idempotencyKey, good.calls[0].ctx.idempotencyKey, "percobaan ulang memakai kunci baru");
    assert.ok(rec.updates.some((u) => u.table === "handoff_tickets" && u.patch.status === "resolved"), "tiket ditutup setelah sukses");
    assert.ok(rec.updates.some((u) => u.table === "booking_drafts" && u.patch.status === "completed"));
  }

  // ── 5. Nomor telepon aktif WhatsApp, format 62xxxx ────────────────────────
  assert.equal(normalizeWaNumber("0812-3456-7890"), "6281234567890");
  assert.equal(normalizeWaNumber("+62 812 3456 7890"), "6281234567890");
  assert.equal(normalizeWaNumber("6281234567890"), "6281234567890");
  assert.equal(normalizeWaNumber("08123456789"), "628123456789");
  assert.equal(normalizeWaNumber("812345678901"), "62812345678901");
  assert.equal(normalizeWaNumber("123"), null);
  assert.equal(normalizeWaNumber(""), null);
  {
    const c: BookingContext = {};
    assert.equal(proposeGuestPhone(c, WA, "081234567890"), "same", "nomor sama dengan WA thread → langsung dipakai");
    assert.equal(c.guestPhone, "6281234567890");
    assert.equal(c.pendingPhone, undefined);
    assert.equal(proposeGuestPhone(c, WA, "0857 1111 2222"), "pending", "nomor lain → tunggu konfirmasi");
    assert.equal(c.pendingPhone, "6285711112222");
    assert.equal(c.guestPhone, "6281234567890", "guestPhone belum berubah");
    assert.equal(proposeGuestPhone(c, WA, "abc"), "invalid");
  }
  // Tamu menyebut nomor lain saat mengisi data → ditanya aktif WhatsApp dulu, belum dipakai.
  {
    const { db, rec } = makeDb();
    const ctxCollect = { ...confirmingContext(), guestName: undefined, quotedTotal: undefined, totalPrice: undefined, guestPhone: undefined };
    const res = await processBookingState(
      makeCtx(db),
      WA,
      "atas nama Budi, 2 orang, nomor 0857 1111 2222",
      record("COLLECTING_DATA", ctxCollect as BookingContext),
    );
    assert.match(res.reply ?? "", /\+6285711112222.*aktif WhatsApp/s);
    const st = rec.states.at(-1)!;
    assert.equal(st.context.pendingPhone, "6285711112222");
    assert.notEqual(st.context.guestPhone, "6285711112222", "belum dipakai sebelum dikonfirmasi");
  }
  // Konfirmasi tamu "ya, aktif" → nomor lain dipakai; write memakai 62xxxx.
  {
    const { db, rec } = makeDb();
    const w = makeFakeWriter();
    const ctxPending = confirmingContext({ pendingPhone: "6285711112222" });
    const r1 = await processBookingState(makeCtx(db), WA, "ya aktif kak", record("CONFIRMING_BOOKING", ctxPending), { createBookingImpl: w.impl });
    assert.equal(w.calls.length, 0, "konfirmasi nomor BUKAN konfirmasi booking — belum menulis");
    assert.match(r1.reply ?? "", /6285711112222/);
    const st = rec.states.at(-1)!;
    assert.equal(st.context.guestPhone, "6285711112222");
    assert.equal(st.context.pendingPhone, undefined);
    const r2 = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", st.context, "2026-10-02T10:06:00.000Z"), { createBookingImpl: w.impl });
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0].args.phone, "6285711112222");
    assert.match(r2.reply ?? "", /PG-/);
  }
  // Tamu menolak nomor lain → kembali ke nomor WA thread.
  {
    const { db, rec } = makeDb();
    const w = makeFakeWriter();
    const ctxPending = confirmingContext({ pendingPhone: "6285711112222" });
    await processBookingState(makeCtx(db), WA, "bukan, pakai nomor ini saja", record("CONFIRMING_BOOKING", ctxPending), { createBookingImpl: w.impl });
    assert.equal(rec.states.at(-1)!.context.guestPhone, WA);
    assert.equal(w.calls.length, 0);
  }
  // Pesan tak terkait saat menunggu konfirmasi nomor → pertanyaan diulang, tidak menulis booking.
  {
    const { db } = makeDb();
    const w = makeFakeWriter();
    const res = await processBookingState(makeCtx(db), WA, "hmm gimana", record("CONFIRMING_BOOKING", confirmingContext({ pendingPhone: "6285711112222" })), { createBookingImpl: w.impl });
    assert.match(res.reply ?? "", /aktif WhatsApp/i);
    assert.equal(w.calls.length, 0);
  }
  // Nomor lokal 08xx di context dinormalkan ke 62xxxx saat write.
  {
    const { db } = makeDb();
    const w = makeFakeWriter();
    await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", confirmingContext({ guestPhone: "081234567890" })), { createBookingImpl: w.impl });
    assert.equal(w.calls[0].args.phone, "6281234567890");
  }

  // ── 6. Total: satu sumber integer rupiah, tanpa selisih rounding ───────────
  assert.equal(toRupiah(999999.9999999), 1000000);
  assert.equal(toRupiah(333333.33 * 3), 1000000, "rata-rata pecahan × malam dibulatkan sekali");
  assert.equal(toRupiah(-5), 0);
  assert.equal(toRupiah("abc"), 0);
  assert.equal(computeGrandTotal({ roomSubtotal: 700000, extraBeds: 1, extraBedRate: 80000, nights: 2 }), 860000);
  assert.equal(computeGrandTotal({ roomSubtotal: 700000, extraBeds: 1, extraBedRate: 0, nights: 2 }), 700000, "extra bed tanpa tarif tidak dihitung");
  assert.equal(computeGrandTotal({ roomSubtotal: 999999.6, nights: 3 }), 1000000);
  assert.ok(totalsMatch(1000000, 999999.9999999));
  assert.ok(!totalsMatch(999999, 1000000));
  {
    const src = readFileSync(resolve(process.cwd(), "src/tools/booking.tool.ts"), "utf8");
    const guardAt = src.indexOf("total_mismatch: true");
    assert.ok(guardAt > 0, "create_booking punya guard total terkonfirmasi");
    assert.ok(src.includes("computeGrandTotal("), "create_booking memakai sumber total tunggal");
    assert.ok(guardAt < src.indexOf("await resolveOrCreateGuest("), "guard total berjalan SEBELUM write apa pun");
    const sm = readFileSync(resolve(process.cwd(), "src/ai/state-machine/booking-machine.ts"), "utf8");
    assert.ok(sm.includes("computeGrandTotal("), "ringkasan konfirmasi memakai sumber total tunggal yang sama");
  }
  // Server menolak karena total beda → tidak ada booking, tamu dapat angka sistem & konfirmasi ulang.
  {
    const { db, rec } = makeDb();
    const mismatch = makeFakeWriter({ fail: "mismatch", serverTotal: 1000000 });
    const res = await processBookingState(
      makeCtx(db),
      WA,
      "ya",
      record("CONFIRMING_BOOKING", confirmingContext({ quotedTotal: 999999 })),
      { createBookingImpl: mismatch.impl },
    );
    assert.equal(mismatch.calls[0].args.expected_total, 999999);
    const reply = res.reply ?? "";
    assert.match(reply, /Rp1\.000\.000/, "menyebut angka sistem");
    assert.match(reply, /Rp999\.999/, "menyebut angka yang tadi");
    assert.match(reply, /belum saya catat/i);
    assert.doesNotMatch(reply, /berhasil dibuat|PG-\d+/);
    assert.equal(res.followUp, undefined);
    assert.equal(rec.states.at(-1)!.state, "CONFIRMING_BOOKING");
    assert.equal(rec.states.at(-1)!.context.quotedTotal, 1000000, "angka sistem jadi total yang dikonfirmasi berikutnya");
    assert.equal(rec.inserts.filter((i) => i.table === "handoff_tickets").length, 0, "bukan kegagalan write → tanpa tiket staf");
    // Konfirmasi ulang dengan angka sistem → lanjut tulis.
    const ok = makeFakeWriter();
    const again = await processBookingState(makeCtx(db), WA, "ya", record("CONFIRMING_BOOKING", rec.states.at(-1)!.context, "2026-10-02T10:07:00.000Z"), { createBookingImpl: ok.impl });
    assert.equal(ok.calls[0].args.expected_total, 1000000);
    assert.match(again.reply ?? "", /PG-/);
  }
  // create_booking NYATA: total terkonfirmasi beda 1 rupiah dari hitungan server → ditolak sebelum menulis.
  {
    const frac = { ...ROOM, base_rate: 333333.33, extrabed_rate: 0 };
    const writes: string[] = [];
    const tables: Record<string, any[]> = { rooms: [{ id: "room-1", number: "101" }] };
    const mk = (): any => {
      const b: any = {};
      for (const m of ["select", "eq", "order", "limit", "in", "gte", "lt", "gt", "not"]) b[m] = () => b;
      return b;
    };
    const admin: any = {
      from: (t: string) => {
        const b = mk();
        b.insert = () => { writes.push(`insert:${t}`); return b; };
        b.delete = () => { writes.push(`delete:${t}`); return b; };
        b.update = () => { writes.push(`update:${t}`); return b; };
        b.maybeSingle = async () => ({ data: null, error: null });
        b.single = async () => ({ data: null, error: new Error("tidak boleh sampai sini") });
        b.then = (r: any) => r({ data: tables[t] ?? [], error: null });
        return b;
      },
    };
    const pub: any = {
      ...admin,
      rpc: async () => ({ data: [{ room_type_id: frac.id, available: 1 }], error: null }),
    };
    const ctx: any = { supabaseAdmin: admin, supabasePublic: pub, rooms: [frac], property: { id: "prop-1" }, today: "2026-10-02", phone: WA };
    const base = {
      room_type: "Deluxe",
      full_name: "Budi Santoso",
      phone: WA,
      check_in: "2026-11-10",
      check_out: "2026-11-13",
      adults: 2,
    };
    const out = JSON.parse(await createBooking({ ...base, expected_total: 999999 }, ctx));
    assert.equal(out.ok, false);
    assert.equal(out.total_mismatch, true);
    assert.equal(out.server_total, 1000000, "333.333,33 × 3 malam dibulatkan ke integer 1.000.000");
    assert.equal(out.confirmed_total, 999999);
    assert.deepEqual(writes, [], "tidak ada insert/update/delete saat total beda");
    const pass = JSON.parse(await createBooking({ ...base, expected_total: 1000000 }, ctx).catch(() => "{}") || "{}");
    assert.notEqual(pass.total_mismatch, true, "total sama persis lolos guard");
  }

  console.log("test-booking-confirm-flow: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
