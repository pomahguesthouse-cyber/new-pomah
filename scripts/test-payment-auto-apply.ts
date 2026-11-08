/**
 * Integrasi (mock) pencatatan pembayaran otomatis:
 * bukti masuk → processInboundMedia → OCR(mock) + matcher asli → eligibility
 * → apply_payment_proof (fake DB yang meniru SQL: kunci + UNIQUE) → sinkron
 * invoice → klaim outbox → notifikasi WA (mock). Tidak ada DB/WA sungguhan.
 */
import assert from "node:assert/strict";
import { processInboundMedia, type InboundMediaDeps } from "../src/services/wa-inbound-media";
import { matchProofToCandidates, type PaymentMatchCandidate } from "../src/services/payment-proof-match";
import {
  autoApplyPaymentProof,
  evaluateAutoApplyEligibility,
  retryPendingPaymentNotices,
  normalizeReference,
} from "../src/services/payment-auto-apply";
import { resolveEditedPaymentTotals, statusFromCumulative } from "../src/services/payment-totals";
import { OFFICIAL_TRANSFER_ACCOUNT } from "../src/lib/payment-account";

const PHONE = "6281900000963";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const NOW = new Date();

// ─── Fake DB (semantik meniru supabase/manual/20261108_payment_applications.sql) ─
function fakeDb(bookings: any[], opts: { migrated?: boolean; paused?: boolean } = {}) {
  const t: Record<string, any[]> = {
    bookings,
    payment_applications: [],
    invoices: bookings.map((b) => ({ booking_id: b.id, payment_status_snapshot: b.payment_status })),
    whatsapp_threads: [{ id: "th1", phone: PHONE, ai_auto: !opts.paused, ai_paused_until: null }],
    whatsapp_messages: [],
  };
  let seq = 0;
  const from = (name: string) => {
    const f: Array<(r: any) => boolean> = [];
    let lim = Infinity;
    const q: any = {};
    const rows = () => t[name].filter((r) => f.every((fn) => fn(r))).slice(0, lim);
    const shapeRow = (r: any) =>
      name === "bookings" ? { ...r, guests: { id: "g1", full_name: "Tamu Uji", phone: r.phone }, properties: { public_domain: "pomahguesthouse.com" } } : r;
    q.select = () => q;
    q.order = () => q;
    q.eq = (c: string, v: any) => (f.push((r) => r[c] === v), q);
    q.in = (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q);
    q.lt = (c: string, v: any) => (f.push((r) => r[c] < v), q);
    q.contains = (_c: string, v: any) => (f.push((r) => r.metadata?.notice_key === v.notice_key), q);
    q.limit = (n: number) => ((lim = n), q);
    q.maybeSingle = async () => ({ data: rows()[0] ? shapeRow(rows()[0]) : null, error: null });
    q.single = async () => (rows()[0] ? { data: shapeRow(rows()[0]), error: null } : { data: null, error: { message: "nf" } });
    q.insert = async (row: any) => (t[name].push(row), { error: null });
    q.then = (res: any) => res({ data: rows().map(shapeRow), error: null });
    return q;
  };
  const rpc = async (fn: string, a: any) => {
    if (opts.migrated === false) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (fn === "apply_payment_proof") {
      // Sinkron penuh dalam satu tick = setara transaksi + FOR UPDATE.
      const ref = normalizeReference(a.p_reference);
      if (ref.length < 6) return { data: { ok: false, reason: "missing_reference" }, error: null };
      const b = t.bookings.find((x) => x.id === a.p_booking_id);
      if (!b) return { data: { ok: false, reason: "booking_not_found" }, error: null };
      if (b.status === "cancelled") return { data: { ok: false, reason: "booking_closed" }, error: null };
      if (b.phone !== a.p_phone) return { data: { ok: false, reason: "not_owner" }, error: null };
      const fee = Number(a.p_received) - Number(a.p_amount);
      if (fee < 0 || fee > 6500) return { data: { ok: false, reason: "amount_mismatch" }, error: null };
      if (Number(b.paid_amount) !== Number(a.p_expected_paid)) return { data: { ok: false, reason: "paid_amount_changed" }, error: null };
      const newPaid = Number(b.paid_amount) + Number(a.p_amount);
      if (newPaid > b.total_amount) return { data: { ok: false, reason: "overpayment" }, error: null };
      if (t.payment_applications.some((p) => p.reference_norm === ref || p.source_message_id === a.p_message_id)) {
        return { data: { ok: false, reason: "duplicate_reference" }, error: null };
      }
      const status = newPaid >= b.total_amount ? "paid" : "partial";
      const id = `app-${++seq}`;
      t.payment_applications.push({
        id, booking_id: b.id, reference_norm: ref, source_message_id: a.p_message_id, amount: a.p_amount,
        paid_before: b.paid_amount, paid_after: newPaid, notice_status: "pending", notice_attempts: 0,
        created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      });
      const before = b.paid_amount;
      b.paid_amount = newPaid; // total_amount tidak disentuh
      b.payment_status = status;
      for (const inv of t.invoices) if (inv.booking_id === b.id) inv.payment_status_snapshot = status;
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
  return t.bookings.map((b) => ({ bookingCode: b.reference_code, total: b.total_amount, paid: b.paid_amount, status: b.status, paymentStatus: b.payment_status, createdAt: b.created_at, checkIn: "2099-12-01", checkOut: "2099-12-04", nights: 3, source: "booking" as const }));
}
function ocr(nominal: number, ref: string | null, rightAccount = true) {
  return {
    bank_pengirim: "BCA", bank_tujuan: "BCA", nominal, biaya_admin: 0, total_dibayar: nominal,
    tanggal: "08/11/2026", nama_pengirim: "TAMU UJI", nomor_referensi: ref,
    rekening_tujuan: rightAccount ? OFFICIAL_TRANSFER_ACCOUNT.accountNumber : "1234567890",
    raw_text: "Transfer berhasil",
  } as any;
}

function harness(fdb: ReturnType<typeof fakeDb>, send: { ok: boolean; sent: string[] }) {
  const meta = new Map<string, Record<string, unknown>>();
  const staff: string[] = [];
  const syncs: string[] = [];
  let nextOcr: any = null;
  const autoDeps = {
    syncInvoice: async (id: string) => { syncs.push(`${id}:${fdb.t.invoices.find((i) => i.booking_id === id)?.payment_status_snapshot}`); return { status: "ok" }; },
    notice: {
      send: async (_p: string, body: string) => { if (!send.ok) return { ok: false, error: "meta down" }; send.sent.push(body); return { ok: true }; },
      resolveThread: (async () => "th1") as any,
    },
  };
  const deps: InboundMediaDeps = {
    download: async () => ({ ok: true, bytes: JPEG, mime: "image/jpeg", size: JPEG.byteLength }) as any,
    upload: async () => ({ ok: true }),
    readMetadata: async (id) => meta.get(id) ?? null,
    saveMetadata: async (id, patch) => { meta.set(id, { ...(meta.get(id) ?? {}), ...patch }); },
    analyze: async () => {
      const match = matchProofToCandidates(nextOcr, candidatesFrom(fdb.t), { now: NOW });
      return { ok: true, ocr: nextOcr, match } as any;
    },
    loadPaymentContext: async () => ({ awaiting: true, bookingRef: "PG-AUTO1", guestName: "Tamu Uji" }),
    claimNotice: async (n) => (staff.push(n.messageId), "sent"),
    autoApply: ({ messageId, phone, result }) =>
      autoApplyPaymentProof({ supabase: fdb.db, phone, messageId, ocr: result.ocr, match: result.match, deps: autoDeps }),
  };
  const run = async (messageId: string, o: any, sentAt: Date = NOW) => {
    nextOcr = o;
    await processInboundMedia(
      { phone: PHONE, guestName: "Tamu Uji", messageId, threadId: "th1", at: NOW, sentAt, now: NOW, media: { mediaId: `m-${messageId}`, mediaType: "image", mimeType: "image/jpeg", fileName: null } },
      deps,
    );
    return meta.get(messageId)?.payment_auto_apply as any;
  };
  return { run, meta, staff, syncs, autoDeps };
}

async function main() {
  // 1. Lunas penuh: bukti → paid, total utuh, snapshot invoice paid, notifikasi LUNAS sekali.
  {
    const f = fakeDb([booking()]);
    const s = { ok: true, sent: [] as string[] };
    const h = harness(f, s);
    const r = await h.run("msg1", ocr(830000, "REF-ABC-123456"));
    assert.equal(r.status, "applied", JSON.stringify(r));
    assert.equal(f.t.bookings[0].payment_status, "paid");
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    assert.equal(f.t.bookings[0].total_amount, 830000);
    assert.deepEqual(h.syncs, ["bk1:paid"]);
    assert.equal(s.sent.length, 1);
    assert.match(s.sent[0], /LUNAS/);
    assert.match(s.sent[0], /Pembayaran ini: Rp830\.000/);
    assert.match(s.sent[0], /Sisa: Rp0/);
    assert.doesNotMatch(s.sent[0], new RegExp(OFFICIAL_TRANSFER_ACCOUNT.accountNumber));
    assert.equal(f.t.payment_applications[0].notice_status, "sent");
    assert.equal(h.staff.length, 1, "staf tetap diberi tahu (audit)");

    // Webhook retry pesan yang sama → tidak dobel.
    await h.run("msg1", ocr(830000, "REF-ABC-123456"));
    assert.equal(f.t.payment_applications.length, 1, "retry webhook tidak dobel");
    // Bahkan bila booking dibuka lagi (paid diset ulang), referensi tetap terkunci.
    const direct = await autoApplyPaymentProof({ supabase: f.db, phone: PHONE, messageId: "msg1", ocr: ocr(830000, "REF-ABC-123456"), match: { ...(h.meta.get("msg1") as any).ocr_match_test, status: "matched_full", destination_ok: true, candidate_fit_count: 1, booking_code: "PG-AUTO1", expected_amount: 0 } as any });
    assert.notEqual(direct.status, "applied");
    // Gambar baru / id baru, referensi sama (beda format) → tidak dobel.
    const r3 = await h.run("msg2", ocr(830000, "refabc 123456"));
    assert.notEqual(r3.status, "applied");
    assert.equal(f.t.payment_applications.length, 1);
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    assert.equal(s.sent.length, 1);
  }

  // 2. DP lalu pelunasan: partial → paid, nominal kumulatif & sisa benar.
  {
    const f = fakeDb([booking()]);
    const s = { ok: true, sent: [] as string[] };
    const h = harness(f, s);
    const r = await h.run("dp", ocr(415000, "DPREF0001"));
    assert.equal(r.status, "applied", JSON.stringify(r));
    assert.equal(f.t.bookings[0].payment_status, "partial");
    assert.equal(f.t.bookings[0].paid_amount, 415000);
    assert.match(s.sent[0], /DIBAYAR SEBAGIAN \(DP\)/);
    assert.match(s.sent[0], /Sisa: Rp415\.000/);
    const r2 = await h.run("rest", ocr(415000, "LUNASREF02"));
    assert.equal(r2.status, "applied", JSON.stringify(r2));
    assert.equal(f.t.bookings[0].payment_status, "paid");
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    assert.equal(f.t.bookings[0].total_amount, 830000);
    assert.match(s.sent[1], /LUNAS/);
    assert.match(s.sent[1], /Total dibayar: Rp830\.000/);
  }

  // 3. Lebih bayar dalam toleransi biaya transfer (≤ 6.500) → dicatat sebesar tagihan.
  {
    const f = fakeDb([booking()]);
    const s = { ok: true, sent: [] as string[] };
    const r = await harness(f, s).run("fee", ocr(836500, "FEEREF0001"));
    assert.equal(r.status, "applied", JSON.stringify(r));
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    assert.equal(f.t.bookings[0].total_amount, 830000);
  }

  // 4. Tidak layak → ke staf, tidak ada perubahan.
  const ineligible: Array<[string, any, any[]?]> = [
    ["kurang bayar", ocr(300000, "UNDER00001")],
    ["salah bayar (overpaid)", ocr(900000, "OVER000001")],
    ["rekening tujuan salah", ocr(830000, "WRONGACC01", false)],
    ["tanpa referensi", ocr(830000, null)],
    ["referensi terlalu pendek", ocr(830000, "12")],
    ["dua booking sama nominal", ocr(830000, "AMBIG00001"), [booking(), booking({ id: "bk2", reference_code: "PG-AUTO2" })]],
  ];
  for (const [label, o, bks] of ineligible) {
    const f = fakeDb(bks ?? [booking()]);
    const s = { ok: true, sent: [] as string[] };
    const h = harness(f, s);
    const r = await h.run(`x-${label}`, o);
    assert.notEqual(r?.status, "applied", label);
    assert.equal(f.t.payment_applications.length, 0, label);
    assert.ok(f.t.bookings.every((b) => b.paid_amount === 0 && b.payment_status === "unpaid"), label);
    assert.equal(s.sent.length, 0, label);
    assert.equal(h.staff.length, 1, `${label}: staf menerima bukti`);
  }

  // 5. Bukti lama (sweeper/backfill) tidak dicatat otomatis.
  {
    const f = fakeDb([booking()]);
    const r = await harness(f, { ok: true, sent: [] }).run("old", ocr(830000, "OLDREF0001"), new Date(NOW.getTime() - 3 * 86_400_000));
    assert.equal(r, undefined);
    assert.equal(f.t.payment_applications.length, 0);
  }

  // 6. Migrasi belum dijalankan → fail-safe ke staf.
  {
    const f = fakeDb([booking()], { migrated: false });
    const h = harness(f, { ok: true, sent: [] });
    const r = await h.run("nm", ocr(830000, "NOMIG00001"));
    assert.equal(r.status, "not_migrated");
    assert.equal(f.t.bookings[0].payment_status, "unpaid");
    assert.equal(h.staff.length, 1);
  }

  // 7. Bukan pemilik booking → ditolak.
  {
    const f = fakeDb([booking({ phone: "6281111111111" })]);
    const m = matchProofToCandidates(ocr(830000, "OWNREF0001"), candidatesFrom(f.t), { now: NOW });
    const r = await autoApplyPaymentProof({ supabase: f.db, phone: PHONE, messageId: "own", ocr: ocr(830000, "OWNREF0001"), match: m });
    assert.deepEqual(r, { status: "rejected", reason: "not_owner" });
  }

  // 8. Konkurensi: dua bukti beda referensi diproses paralel untuk tagihan yang sama.
  {
    const f = fakeDb([booking()]);
    const s = { ok: true, sent: [] as string[] };
    const h = harness(f, s);
    const mk = (ref: string) => {
      const o = ocr(830000, ref);
      const m = matchProofToCandidates(o, candidatesFrom(f.t), { now: NOW });
      return () => autoApplyPaymentProof({ supabase: f.db, phone: PHONE, messageId: `c-${ref}`, ocr: o, match: m, deps: h.autoDeps });
    };
    const a = mk("CONC000001"), b = mk("CONC000002");
    const [ra, rb] = await Promise.all([a(), b()]);
    const applied = [ra, rb].filter((r) => r.status === "applied");
    assert.equal(applied.length, 1, JSON.stringify([ra, rb]));
    assert.equal(f.t.bookings[0].paid_amount, 830000);
    // Referensi sama paralel dari dua pesan → satu saja.
    const f2 = fakeDb([booking()]);
    const o = ocr(830000, "SAMEREF001");
    const m2 = matchProofToCandidates(o, candidatesFrom(f2.t), { now: NOW });
    const rs = await Promise.all(["p1", "p2", "p3"].map((id) => autoApplyPaymentProof({ supabase: f2.db, phone: PHONE, messageId: id, ocr: o, match: m2, deps: h.autoDeps })));
    assert.equal(rs.filter((r) => r.status === "applied").length, 1);
    assert.equal(f2.t.payment_applications.length, 1);
  }

  // 9. Notifikasi gagal → tersimpan "failed", cron mengirim ulang sekali (tanpa dobel).
  {
    const f = fakeDb([booking()]);
    const s = { ok: false, sent: [] as string[] };
    const h = harness(f, s);
    const r = await h.run("nf", ocr(830000, "NOTIFAIL01"));
    assert.equal(r.status, "applied");
    assert.equal(r.notice, "failed");
    assert.equal(f.t.payment_applications[0].notice_status, "failed");
    s.ok = true;
    await retryPendingPaymentNotices(f.db, h.autoDeps);
    assert.equal(s.sent.length, 1);
    assert.equal(f.t.payment_applications[0].notice_status, "sent");
    await retryPendingPaymentNotices(f.db, h.autoDeps);
    assert.equal(s.sent.length, 1, "tidak dobel setelah terkirim");
  }

  // 10. Jeda staf: catat & sinkron invoice, notifikasi ditahan (pending) — tidak bypass.
  {
    const f = fakeDb([booking()], { paused: true });
    const s = { ok: true, sent: [] as string[] };
    const h = harness(f, s);
    const r = await h.run("pz", ocr(830000, "PAUSEREF01"));
    assert.equal(r.status, "applied");
    assert.equal(r.notice, "deferred_staff_pause");
    assert.equal(s.sent.length, 0);
    assert.equal(f.t.payment_applications[0].notice_status, "pending");
    await retryPendingPaymentNotices(f.db, h.autoDeps);
    assert.equal(s.sent.length, 0, "cron juga menghormati jeda");
    f.t.whatsapp_threads[0].ai_auto = true;
    await retryPendingPaymentNotices(f.db, h.autoDeps);
    assert.equal(s.sent.length, 1);
  }

  // 11. Eligibility murni: argumen LLM tidak berpengaruh; status mentah harus matched_*.
  {
    const base: any = { status: "matched", destination_ok: true, candidate_fit_count: 1, booking_code: "PG-X", expected_amount: 1 };
    assert.equal(evaluateAutoApplyEligibility({ nomor_referensi: "ABCDEF12" }, base).eligible, false);
    assert.equal(evaluateAutoApplyEligibility({ nomor_referensi: "ABCDEF12" }, { ...base, status: "matched_full", received_amount: 1 }).eligible, true);
    // matched_* tetapi diterima < tagihan (mis. toleransi matcher) → tidak otomatis.
    assert.equal(evaluateAutoApplyEligibility({ nomor_referensi: "ABCDEF12" }, { ...base, status: "matched_full", expected_amount: 830000, received_amount: 829000 }).eligible, false);
    assert.equal(evaluateAutoApplyEligibility({ nomor_referensi: "ABCDEF12" }, { ...base, status: "matched_full", expected_amount: 830000, received_amount: 836501 }).eligible, false);
    assert.equal(evaluateAutoApplyEligibility({ nomor_referensi: "ABCDEF12" }, { ...base, status: "matched_full", candidate_fit_count: 2 }).eligible, false);
  }

  // 12. Edit admin: total tidak ditimpa paid_amount.
  {
    assert.deepEqual(resolveEditedPaymentTotals({ computedTotal: 830000, status: "paid", paidAmount: 400000 }), { total: 830000, paid: 400000, status: "partial" });
    assert.deepEqual(resolveEditedPaymentTotals({ computedTotal: 830000, status: "paid", paidAmount: 900000 }), { total: 830000, paid: 900000, status: "paid" });
    // Tidak ada inferensi "lunas tanpa nominal": nominal 0 tidak pernah jadi lunas.
    assert.deepEqual(resolveEditedPaymentTotals({ computedTotal: 830000, status: "paid", paidAmount: 0 }), { total: 830000, paid: 0, status: "unpaid" });
    assert.deepEqual(resolveEditedPaymentTotals({ computedTotal: 830000, status: "unpaid", paidAmount: 5 }), { total: 830000, paid: 0, status: "unpaid" });
    assert.equal(statusFromCumulative(829999, 830000), "partial");
  }

  console.log("test-payment-auto-apply: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
