/**
 * Tes pencocokan mutasi × bukti: proof-first, mutation-first, ambigu,
 * underpay, overpay tolerance, konkurensi, mode flag, timeout (bukan auto-lunas).
 */
import assert from "node:assert/strict";
import { matchProofToCandidates, type PaymentMatchCandidate } from "../src/services/payment-proof-match";
import {
  handleFreshPaymentProof,
  ingestMootaMutations,
  processStoredMutation,
  expireWaitingProofs,
  formatTodayBankMutations,
  buildWaitingMutationGuestNotice,
  type MutationMatchDeps,
} from "../src/services/bank-mutation-match";
import { autoApplyPaymentProof } from "../src/services/payment-auto-apply";
import { OFFICIAL_TRANSFER_ACCOUNT } from "../src/lib/payment-account";
import { parseMootaMutation } from "../src/lib/moota";
import { buildPaymentStatusNotice } from "../src/services/payment-status-notice";

const PHONE = "6281900000963";
const NOW = new Date("2026-11-13T08:00:00+07:00");

function fakeDb(bookings: any[], opts: { migrated?: boolean } = {}) {
  const t: Record<string, any[]> = {
    bookings,
    payment_applications: [],
    payment_proof_pending: [],
    bank_mutations: [],
    invoices: bookings.map((b) => ({ booking_id: b.id, payment_status_snapshot: b.payment_status })),
    whatsapp_threads: [{ id: "th1", phone: PHONE, ai_auto: true, ai_paused_until: null }],
  };
  let seq = 0;
  const missing = () => ({ data: null, error: { code: "PGRST205", message: "Could not find the table" } });
  const from = (name: string) => {
    if (opts.migrated === false && (name === "payment_proof_pending" || name === "bank_mutations")) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        lt: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => missing(),
        insert: () => ({ error: { code: "PGRST205", message: "Could not find the table" }, select: () => ({ maybeSingle: async () => missing() }) }),
        update: () => ({ eq: () => ({ eq: () => ({ error: { code: "PGRST205" } }), is: () => ({ error: { code: "PGRST205" } }), then: (res: any) => res({ error: { code: "PGRST205" } }) }) }),
        then: (res: any) => res(missing()),
      };
      return q;
    }
    const f: Array<(r: any) => boolean> = [];
    let lim = Infinity;
    let insSelect: string | null = null;
    const q: any = {};
    const rows = () => t[name].filter((r) => f.every((fn) => fn(r))).slice(0, lim);
    const shapeRow = (r: any) =>
      name === "bookings"
        ? { ...r, guests: { id: "g1", full_name: "Tamu Uji", phone: r.phone }, properties: { public_domain: "pomahguesthouse.com" } }
        : r;
    q.select = (cols?: string) => {
      if (insSelect === "pending") {
        // after insert().select()
      }
      q._cols = cols;
      return q;
    };
    q.order = () => q;
    q.eq = (c: string, v: any) => (f.push((r) => r[c] === v), q);
    q.neq = (c: string, v: any) => (f.push((r) => r[c] !== v), q);
    q.in = (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q);
    q.is = (c: string, v: any) => (f.push((r) => r[c] == v), q);
    q.lt = (c: string, v: any) => (f.push((r) => r[c] < v), q);
    q.gte = (c: string, v: any) => (f.push((r) => r[c] >= v), q);
    q.limit = (n: number) => ((lim = n), q);
    q.maybeSingle = async () => ({ data: rows()[0] ? shapeRow(rows()[0]) : null, error: null });
    q.single = async () => (rows()[0] ? { data: shapeRow(rows()[0]), error: null } : { data: null, error: { message: "nf" } });
    q.insert = (row: any) => {
      if (name === "payment_proof_pending" && t.payment_proof_pending.some((p) => p.message_id === row.message_id)) {
        const errQ: any = Promise.resolve({ error: { code: "23505", message: "duplicate" }, data: null });
        errQ.select = () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) });
        return errQ;
      }
      if (name === "bank_mutations" && t.bank_mutations.some((m) => m.mutation_id === row.mutation_id)) {
        return { error: { code: "23505", message: "duplicate" } };
      }
      const full = { id: row.id ?? `${name}-${++seq}`, created_at: row.created_at ?? NOW.toISOString(), ...row };
      t[name].push(full);
      const iq: any = {
        select: () => ({
          maybeSingle: async () => ({ data: full, error: null }),
        }),
        then: (res: any) => res({ error: null, data: full }),
      };
      return iq;
    };
    q.update = (patch: any) => {
      const uq: any = {};
      const uf: Array<(r: any) => boolean> = [];
      uq.eq = (c: string, v: any) => (uf.push((r) => r[c] === v), uq);
      uq.is = (c: string, v: any) => (uf.push((r) => r[c] == v), uq);
      uq.then = (res: any) => {
        for (const r of t[name]) if (uf.every((fn) => fn(r))) Object.assign(r, patch);
        return res({ error: null });
      };
      // also support await without then on chained eq only — supabase returns a thenable
      const run = async () => {
        for (const r of t[name]) if (uf.every((fn) => fn(r))) Object.assign(r, patch);
        return { error: null };
      };
      uq.eq = (c: string, v: any) => {
        uf.push((r) => r[c] === v);
        const out: any = { eq: uq.eq, is: uq.is, then: (res: any, rej?: any) => run().then(res, rej) };
        return out;
      };
      uq.is = (c: string, v: any) => {
        uf.push((r) => r[c] == v);
        const out: any = { eq: uq.eq, is: uq.is, then: (res: any, rej?: any) => run().then(res, rej) };
        return out;
      };
      return uq;
    };
    q.then = (res: any) => res({ data: rows().map(shapeRow), error: null });
    return q;
  };
  const rpc = async (fn: string, a: any) => {
    if (opts.migrated === false) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (fn === "mark_bank_mutation_status") {
      const m = t.bank_mutations.find((x) => x.mutation_id === a.p_mutation_id);
      if (m && m.match_status !== "matched") {
        m.match_status = a.p_status;
        m.match_reason = a.p_reason;
      }
      return { data: true, error: null };
    }
    if (fn === "apply_payment_with_mutation" || fn === "apply_payment_proof") {
      const ref = String(a.p_reference ?? a.p_mutation_id ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (ref.length < 6) return { data: { ok: false, reason: "missing_reference" }, error: null };
      const b = t.bookings.find((x) => x.id === a.p_booking_id);
      if (!b) return { data: { ok: false, reason: "booking_not_found" }, error: null };
      if (b.status === "cancelled") return { data: { ok: false, reason: "booking_closed" }, error: null };
      if (b.phone !== a.p_phone) return { data: { ok: false, reason: "not_owner" }, error: null };
      const fee = Number(a.p_received) - Number(a.p_amount);
      if (fee < 0 || fee > 6500) return { data: { ok: false, reason: "amount_mismatch" }, error: null };
      if (Number(b.paid_amount) !== Number(a.p_expected_paid)) return { data: { ok: false, reason: "paid_amount_changed" }, error: null };
      if (a.p_mutation_id && t.payment_applications.some((p) => p.mutation_id === a.p_mutation_id)) {
        return { data: { ok: false, reason: "duplicate_mutation" }, error: null };
      }
      if (t.payment_applications.some((p) => p.reference_norm === ref || (a.p_message_id && p.source_message_id === a.p_message_id))) {
        return { data: { ok: false, reason: "duplicate_reference" }, error: null };
      }
      const newPaid = Number(b.paid_amount) + Number(a.p_amount);
      if (newPaid > b.total_amount) return { data: { ok: false, reason: "overpayment" }, error: null };
      const status = newPaid >= b.total_amount ? "paid" : "partial";
      const id = `app-${++seq}`;
      const before = b.paid_amount;
      t.payment_applications.push({
        id, booking_id: b.id, reference_norm: ref, source_message_id: a.p_message_id,
        mutation_id: a.p_mutation_id ?? null, amount: a.p_amount, paid_before: before,
        paid_after: newPaid, notice_status: "pending", notice_attempts: 0,
        created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      });
      b.paid_amount = newPaid;
      b.payment_status = status;
      for (const inv of t.invoices) if (inv.booking_id === b.id) inv.payment_status_snapshot = status;
      if (a.p_mutation_id) {
        const m = t.bank_mutations.find((x) => x.mutation_id === a.p_mutation_id);
        if (m) {
          if (m.match_status === "matched") return { data: { ok: false, reason: "duplicate_mutation" }, error: null };
          m.match_status = "matched";
          m.payment_application_id = id;
        }
      }
      if (a.p_pending_id) {
        const p = t.payment_proof_pending.find((x) => x.id === a.p_pending_id);
        if (p) { p.status = "applied"; p.mutation_id = a.p_mutation_id; }
      }
      return { data: { ok: true, application_id: id, paid_before: before, paid_after: newPaid, total: b.total_amount, status_after: status }, error: null };
    }
    if (fn === "claim_payment_notice") {
      const p = t.payment_applications.find((x) => x.id === a.p_application_id);
      if (!p || p.notice_attempts >= 5 || !["pending", "failed"].includes(p.notice_status)) return { data: null, error: null };
      p.notice_status = "sending";
      p.notice_attempts++;
      p.token = `tok-${++seq}`;
      return { data: p.token, error: null };
    }
    if (fn === "finish_payment_notice") {
      const p = t.payment_applications.find((x) => x.id === a.p_application_id);
      if (p && p.notice_status === "sending" && p.token === a.p_claim_token) {
        p.notice_status = a.p_outcome === "sent" || a.p_outcome === "skipped" ? a.p_outcome : "failed";
      }
      return { data: null, error: null };
    }
    throw new Error(fn);
  };
  return { db: { from, rpc } as any, t };
}

function booking(over: any = {}) {
  return { id: "bk1", reference_code: "PG-AUTO1", status: "confirmed", payment_status: "unpaid", paid_amount: 0, total_amount: 830000, phone: PHONE, created_at: NOW.toISOString(), ...over };
}
function candidatesFrom(t: Record<string, any[]>): PaymentMatchCandidate[] {
  return t.bookings.map((b) => ({
    bookingCode: b.reference_code, total: b.total_amount, paid: b.paid_amount, status: b.status,
    paymentStatus: b.payment_status, createdAt: b.created_at, checkIn: "2099-12-01", checkOut: "2099-12-04",
    nights: 3, source: "booking" as const,
  }));
}
function ocr(nominal: number, ref: string | null, rightAccount = true) {
  return {
    bank_pengirim: "BCA", bank_tujuan: "BCA", nominal, biaya_admin: 0, total_dibayar: nominal,
    tanggal: "13/11/2026", nama_pengirim: "TAMU UJI", nomor_referensi: ref,
    rekening_tujuan: rightAccount ? OFFICIAL_TRANSFER_ACCOUNT.accountNumber : "1234567890",
    raw_text: "Transfer berhasil",
  } as any;
}
function mut(over: Record<string, unknown> = {}) {
  return parseMootaMutation({
    account_number: OFFICIAL_TRANSFER_ACCOUNT.accountNumber,
    date: "2026-11-13 08:05:00",
    description: "TRSF E-BANKING CR BUDI",
    amount: 830000,
    type: "CR",
    mutation_id: "mutA0000001",
    bank_id: "bankBca1",
    ...over,
  })!;
}

function deps(env: Record<string, string>, send: { guest: string[]; managers: string[] }, syncs: string[]): MutationMatchDeps {
  return {
    env: { PAYMENT_MATCH_MODE: "require_mutation", ...env },
    now: NOW,
    syncInvoice: async (id) => { syncs.push(id); return { status: "ok" }; },
    notice: {
      send: async (_p, body) => { send.guest.push(body); return { ok: true }; },
      resolveThread: (async () => "th1") as any,
    },
    notifyGuestWaiting: async ({ body }) => { send.guest.push(body); },
    notifyManagers: async (alert) => { send.managers.push(`${alert.kind}:${alert.dedupeKey}`); },
  };
}

async function main() {
  // Mode proof_only: perilaku lama, langsung applied.
  {
    const f = fakeDb([booking()]);
    const match = matchProofToCandidates(ocr(830000, "REFABC123456"), candidatesFrom(f.t), { now: NOW });
    const r = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-000000000001",
      ocr: ocr(830000, "REFABC123456"), match,
      deps: deps({ PAYMENT_MATCH_MODE: "proof_only" }, { guest: [], managers: [] }, []),
    });
    assert.equal(r.status, "applied", JSON.stringify(r));
    assert.equal(f.t.bookings[0].payment_status, "paid");
  }

  // Proof-first: bukti valid → waiting_mutation, tamu dikabari jujur, belum lunas.
  const send1 = { guest: [] as string[], managers: [] as string[] };
  const f1 = fakeDb([booking()]);
  const match1 = matchProofToCandidates(ocr(830000, "REFABC123456"), candidatesFrom(f1.t), { now: NOW });
  const held = await handleFreshPaymentProof({
    supabase: f1.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000a1",
    ocr: ocr(830000, "REFABC123456"), match: match1,
    deps: deps({}, send1, []),
  });
  assert.equal(held.status, "waiting_mutation", JSON.stringify(held));
  assert.equal(f1.t.bookings[0].payment_status, "unpaid");
  assert.equal(f1.t.payment_applications.length, 0);
  assert.equal(f1.t.payment_proof_pending.length, 1);
  assert.equal(send1.guest.length, 1);
  assert.match(send1.guest[0], /menunggu konfirmasi dana masuk/);
  assert.doesNotMatch(send1.guest[0], /LUNAS/);

  // Mutasi cocok kemudian → applied, invoice + notifikasi terverifikasi.
  const syncs1: string[] = [];
  const ingested = await ingestMootaMutations({
    supabase: f1.db,
    mutations: [mut()],
    deps: deps({}, send1, syncs1),
  });
  assert.equal(ingested.applied, 1, JSON.stringify(ingested));
  assert.equal(f1.t.bookings[0].payment_status, "paid");
  assert.equal(f1.t.bookings[0].paid_amount, 830000);
  assert.equal(f1.t.bank_mutations[0].match_status, "matched");
  assert.equal(f1.t.payment_proof_pending[0].status, "applied");
  assert.ok(send1.guest.some((g) => /terverifikasi/.test(g) || /LUNAS/.test(g)));
  assert.ok(syncs1.includes("bk1"));

  // Replay mutasi yang sama → tidak dobel.
  const again = await ingestMootaMutations({
    supabase: f1.db,
    mutations: [mut()],
    deps: deps({}, send1, []),
  });
  assert.equal(f1.t.payment_applications.length, 1);
  assert.equal(f1.t.bookings[0].paid_amount, 830000);
  assert.equal(again.applied, 0);

  // Mutation-first: mutasi datang dulu, bukti belakangan.
  {
    const f = fakeDb([booking()]);
    const s = { guest: [] as string[], managers: [] as string[] };
    await ingestMootaMutations({ supabase: f.db, mutations: [mut({ mutation_id: "mutB0000002" })], deps: deps({}, s, []) });
    assert.equal(f.t.bank_mutations[0].match_status, "unmatched");
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
    const match = matchProofToCandidates(ocr(830000, "MUTFIRST0001"), candidatesFrom(f.t), { now: NOW });
    const r = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000b1",
      ocr: ocr(830000, "MUTFIRST0001"), match, deps: deps({}, s, []),
    });
    assert.equal(r.status, "applied", JSON.stringify(r));
    assert.equal(f.t.bookings[0].payment_status, "paid");
  }

  // Mutation-first dengan kode booking di berita transfer (lunas, tanpa bukti).
  {
    const f = fakeDb([booking()]);
    const s = { guest: [] as string[], managers: [] as string[] };
    const r = await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutCODE0003", description: "TRSF E-BANKING CR PG-AUTO1 BUDI" })],
      deps: deps({}, s, []),
    });
    assert.equal(r.applied, 1, JSON.stringify(r));
    assert.equal(f.t.bookings[0].payment_status, "paid");
  }

  // Debit diabaikan.
  {
    const f = fakeDb([booking()]);
    await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutDB0000004", type: "DB" })],
      deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.equal(f.t.bank_mutations[0].match_status, "ignored_debit");
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
  }

  // Rekening lain diabaikan.
  {
    const f = fakeDb([booking()]);
    await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutACC000005", account_number: "1111111111" })],
      deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.equal(f.t.bank_mutations[0].match_status, "ignored_account");
  }

  // Underpay: bukti kurang bayar tidak ditahan; mutasi 829k tidak mencocokkan tagihan 830k.
  {
    const f = fakeDb([booking()]);
    const match = matchProofToCandidates(ocr(300000, "UNDER00001"), candidatesFrom(f.t), { now: NOW });
    const r = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000c1",
      ocr: ocr(300000, "UNDER00001"), match, deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.equal(r.status, "ineligible");
    await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutUNDER006", amount: 829000, description: "TRSF PG-AUTO1" })],
      deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
    assert.equal(f.t.payment_applications.length, 0);
  }

  // Overpay dalam toleransi 6.500: dicatat sebesar tagihan.
  {
    const f = fakeDb([booking()]);
    const s = { guest: [] as string[], managers: [] as string[] };
    const match = matchProofToCandidates(ocr(836500, "FEEREF0001"), candidatesFrom(f.t), { now: NOW });
    await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000d1",
      ocr: ocr(836500, "FEEREF0001"), match, deps: deps({}, s, []),
    });
    const r = await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutFEE000007", amount: 836500 })],
      deps: deps({}, s, []),
    });
    assert.equal(r.applied, 1, JSON.stringify(r));
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    assert.equal(f.t.bookings[0].total_amount, 830000);
  }

  // Overpay di atas toleransi tidak auto-apply.
  {
    const f = fakeDb([booking()]);
    const match = matchProofToCandidates(ocr(900000, "OVER000001"), candidatesFrom(f.t), { now: NOW });
    const r = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000e1",
      ocr: ocr(900000, "OVER000001"), match, deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.notEqual(r.status, "applied");
    assert.notEqual(r.status, "waiting_mutation");
  }

  // Ambigu: dua bukti waiting nominal sama + satu mutasi → review, bukan apply.
  {
    const f = fakeDb([booking(), booking({ id: "bk2", reference_code: "PG-AUTO2" })]);
    const s = { guest: [] as string[], managers: [] as string[] };
    const d = deps({}, s, []);
    const m1 = matchProofToCandidates(ocr(830000, "AMBIG00001"), [candidatesFrom(f.t)[0]], { now: NOW });
    const first = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000f1",
      ocr: ocr(830000, "AMBIG00001"), match: m1, deps: d,
    });
    assert.equal(first.status, "waiting_mutation");
    // bukti kedua dari nomor yang sama tidak lolos ownership bk2; buat booking kedua milik nomor sama dulu.
    f.t.bookings[1].phone = PHONE;
    const m2 = matchProofToCandidates(ocr(830000, "AMBIG00002"), [candidatesFrom(f.t)[1]], { now: NOW });
    const second = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000f2",
      ocr: ocr(830000, "AMBIG00002"), match: { ...m2, booking_code: "PG-AUTO2", candidate_fit_count: 1, status: "matched_full", destination_ok: true, expected_amount: 830000, received_amount: 830000 } as any,
      deps: d,
    });
    assert.equal(second.status, "waiting_mutation", JSON.stringify(second));
    const r = await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutAMBIG008" })],
      deps: d,
    });
    assert.equal(r.applied, 0, JSON.stringify(r));
    assert.equal(r.review, 1);
    assert.equal(f.t.bookings.every((b) => b.paid_amount === 0), true);
    assert.ok(s.managers.some((x) => x.startsWith("review:")));
  }

  // Konkurensi: dua mutasi sama nominal, satu bukti — hanya satu apply.
  {
    const f = fakeDb([booking()]);
    const s = { guest: [] as string[], managers: [] as string[] };
    const match = matchProofToCandidates(ocr(830000, "CONC000001"), candidatesFrom(f.t), { now: NOW });
    await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000g1",
      ocr: ocr(830000, "CONC000001"), match, deps: deps({}, s, []),
    });
    const stored = [mut({ mutation_id: "mutCONC0009" }), mut({ mutation_id: "mutCONC0010" })];
    await Promise.all(stored.map((m) => ingestMootaMutations({ supabase: f.db, mutations: [m], deps: deps({}, s, []) })));
    assert.equal(f.t.payment_applications.length, 1, "tepat satu aplikasi");
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    const matched = f.t.bank_mutations.filter((m) => m.match_status === "matched");
    assert.equal(matched.length, 1);
  }

  // Timeout: kabari manajer, jangan auto-lunas.
  {
    const f = fakeDb([booking()]);
    const s = { guest: [] as string[], managers: [] as string[] };
    const match = matchProofToCandidates(ocr(830000, "TIMEOUT0001"), candidatesFrom(f.t), { now: NOW });
    await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000h1",
      ocr: ocr(830000, "TIMEOUT0001"), match, deps: deps({}, s, []),
    });
    f.t.payment_proof_pending[0].created_at = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const exp = await expireWaitingProofs({
      supabase: f.db,
      deps: { ...deps({ PAYMENT_MUTATION_TIMEOUT_MINUTES: "120" }, s, []), now: NOW },
    });
    assert.equal(exp.notified, 1);
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
    assert.equal(f.t.payment_proof_pending[0].status, "waiting_mutation");
    assert.ok(s.managers.some((x) => x.startsWith("timeout:")));
    // Mutasi yang datang terlambat tetap bisa mencocokkan.
    const late = await ingestMootaMutations({
      supabase: f.db,
      mutations: [mut({ mutation_id: "mutLATE0011" })],
      deps: deps({}, s, []),
    });
    assert.equal(late.applied, 1);
    assert.equal(f.t.bookings[0].payment_status, "paid");
  }

  // Migrasi belum ada → not_migrated, tidak mengubah booking.
  {
    const f = fakeDb([booking()], { migrated: false });
    const match = matchProofToCandidates(ocr(830000, "NOMIG00001"), candidatesFrom(f.t), { now: NOW });
    const r = await handleFreshPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000i1",
      ocr: ocr(830000, "NOMIG00001"), match, deps: deps({}, { guest: [], managers: [] }, []),
    });
    assert.equal(r.status, "not_migrated");
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
  }

  // Teks pemberitahuan: mutasi terverifikasi ≠ "dari bukti saja".
  {
    const verified = buildPaymentStatusNotice({
      guestName: "Tamu Uji",
      referenceCode: "PG-AUTO1",
      status: "paid",
      paidAmount: 830000,
      totalAmount: 830000,
      invoiceUrl: "https://pomahguesthouse.com/book/confirmation/PG-AUTO1",
      appliedAmount: 830000,
      verifiedByMutation: true,
    });
    assert.match(verified, /terverifikasi/);
    assert.doesNotMatch(verified, /sudah kami terima dan pembayaran sudah dicatat/);
    const waiting = buildWaitingMutationGuestNotice({ guestName: "Tamu Uji", bookingCode: "PG-AUTO1" });
    assert.match(waiting, /menunggu konfirmasi dana masuk/);
  }

  // format mutasi hari ini
  {
    const text = formatTodayBankMutations([
      { mutation_id: "x", amount: 830000, type: "CR", match_status: "matched", mutation_date: NOW.toISOString(), description: "TRSF BUDI" },
    ], NOW);
    assert.match(text, /Mutasi BCA/);
    assert.match(text, /sudah dicocokkan/);
  }

  // proof_only tetap tersedia lewat autoApply langsung
  {
    const f = fakeDb([booking()]);
    const match = matchProofToCandidates(ocr(830000, "DIRECT00001"), candidatesFrom(f.t), { now: NOW });
    const r = await autoApplyPaymentProof({
      supabase: f.db, phone: PHONE, messageId: "00000000-0000-0000-0000-0000000000j1",
      ocr: ocr(830000, "DIRECT00001"), match,
    });
    assert.equal(r.status, "applied");
  }

  console.log("test-mutation-match: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
