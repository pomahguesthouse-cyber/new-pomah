/**
 * Regresi PG-EC83T (8 Nov 2026): staf menandai lunas setelah OCR matched_full,
 * tamu harus menerima pemberitahuan status SEKALI; DP → "sebagian" + sisa.
 * Semua side effect di-mock (DB & WhatsApp).
 */
import assert from "node:assert/strict";
import { notifyPaymentStatusChange, buildPaymentStatusNotice } from "../src/services/payment-status-notice";

function makeDb(booking: any) {
  const inserted: any[] = [];
  const from = (t: string) => {
    const b: any = { _t: t, _contains: null };
    for (const m of ["select", "eq", "limit", "order"]) b[m] = () => b;
    b.contains = (_c: string, v: any) => { b._contains = v; return b; };
    b.single = async () => ({ data: t === "bookings" ? booking : null, error: null });
    b.insert = async (row: any) => { inserted.push(row); return { error: null }; };
    b.then = (r: any) => {
      if (t === "whatsapp_messages" && b._contains) {
        return r({ data: inserted.filter((m) => m.metadata?.notice_key === b._contains.notice_key), error: null });
      }
      return r({ data: [], error: null });
    };
    return b;
  };
  return { db: { from } as any, inserted };
}

const base = {
  id: "bk-1", reference_code: "PG-TEST1", status: "confirmed",
  total_amount: 830000, guests: { id: "g1", full_name: "Tamu Uji", phone: "6281900000963" },
  properties: { public_domain: "pomahguesthouse.com" },
};
const deps = (sent: string[], ok = true) => ({
  send: async (_p: string, body: string) => { sent.push(body); return ok ? { ok: true } : { ok: false, error: "meta down" }; },
  resolveThread: (async () => "thread-1") as any,
});

async function main() {
  // 0. Klaim atomik manual (RPC tersedia): klaim pertama kirim, kedua ditolak
  //    walau riwayat pesan kosong (tidak bergantung read-then-send).
  {
    const { db } = makeDb({ ...base, payment_status: "paid", paid_amount: 830000 });
    const claims = new Set<string>();
    const finished: any[] = [];
    db.rpc = async (fn: string, a: any) => {
      if (fn === "claim_payment_status_notice") {
        if (claims.has(a.p_notice_key)) return { data: null, error: null };
        claims.add(a.p_notice_key);
        return { data: "tok-1", error: null };
      }
      finished.push(a);
      return { data: true, error: null };
    };
    const sent: string[] = [];
    const before = { payment_status: "unpaid", paid_amount: 0 };
    const [r1, r2] = await Promise.all([
      notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before, deps: deps(sent) }),
      notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before, deps: deps(sent) }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), ["sent", "skipped"]);
    assert.equal(sent.length, 1);
    assert.equal(finished[0].p_ok, true);
  }
  // 1. unpaid → paid (nominal menutup total) → kirim LUNAS sekali.
  {
    const { db, inserted } = makeDb({ ...base, payment_status: "paid", paid_amount: 830000 });
    const sent: string[] = [];
    const r1 = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "unpaid", paid_amount: 0 }, deps: deps(sent) });
    assert.equal(r1.status, "sent");
    assert.match(sent[0], /PG-TEST1/);
    assert.match(sent[0], /LUNAS/);
    assert.match(sent[0], /Sisa: Rp0/);
    assert.doesNotMatch(sent[0], /0095584379|rekening|BCA/i, "tanpa detail rekening");
    assert.doesNotMatch(sent[0], /1\s*x\s*24/i);
    assert.equal(inserted[0].metadata.notice_key, "bk-1:paid:830000");
    // Retry (simpan ulang / klik dua kali) → tidak dobel.
    const r2 = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "unpaid", paid_amount: 0 }, deps: deps(sent) });
    assert.equal(r2.status, "skipped");
    assert.equal(sent.length, 1);
  }
  // 2. DP → sebagian + sisa, bukan lunas.
  {
    const { db } = makeDb({ ...base, payment_status: "partial", paid_amount: 415000 });
    const sent: string[] = [];
    const r = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "unpaid", paid_amount: 0 }, deps: deps(sent) });
    assert.equal(r.status, "sent");
    assert.match(sent[0], /DIBAYAR SEBAGIAN/);
    assert.match(sent[0], /Sisa: Rp415\.000/);
    assert.doesNotMatch(sent[0], /LUNAS/);
  }
  // 3. Pelunasan setelah DP (partial → paid, kumulatif) → kirim LUNAS.
  {
    const { db } = makeDb({ ...base, payment_status: "paid", paid_amount: 830000 });
    const sent: string[] = [];
    const r = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "partial", paid_amount: 415000 }, deps: deps(sent) });
    assert.equal(r.status, "sent");
    assert.match(sent[0], /LUNAS/);
  }
  // 4. Status "paid" tapi nominal < total → JANGAN bilang lunas.
  {
    const { db } = makeDb({ ...base, payment_status: "paid", paid_amount: 400000 });
    const sent: string[] = [];
    const r = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "unpaid", paid_amount: 0 }, deps: deps(sent) });
    assert.equal(r.status, "skipped");
    assert.equal(sent.length, 0);
  }
  // 5. Tidak berubah / unpaid / batal / onsite tanpa bayar → tidak kirim.
  for (const [bk, before] of [
    [{ ...base, payment_status: "paid", paid_amount: 830000 }, { payment_status: "paid", paid_amount: 830000 }],
    [{ ...base, payment_status: "unpaid", paid_amount: 0 }, { payment_status: "paid", paid_amount: 830000 }],
    [{ ...base, status: "cancelled", payment_status: "paid", paid_amount: 830000 }, { payment_status: "unpaid", paid_amount: 0 }],
    [{ ...base, payment_status: "partial", paid_amount: 0 }, { payment_status: "unpaid", paid_amount: 0 }],
  ] as const) {
    const { db } = makeDb(bk);
    const sent: string[] = [];
    const r = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: before as any, deps: deps(sent) });
    assert.equal(r.status, "skipped", JSON.stringify(bk));
    assert.equal(sent.length, 0);
  }
  // 6. Kirim gagal → failed, tidak dicatat (bisa dicoba lagi).
  {
    const { db, inserted } = makeDb({ ...base, payment_status: "paid", paid_amount: 830000 });
    const sent: string[] = [];
    const r = await notifyPaymentStatusChange({ supabase: db, bookingId: "bk-1", before: { payment_status: "unpaid", paid_amount: 0 }, deps: deps(sent, false) });
    assert.equal(r.status, "failed");
    assert.equal(inserted.length, 0);
  }
  assert.match(buildPaymentStatusNotice({ referenceCode: "PG-X", status: "paid", paidAmount: 1, totalAmount: 1, invoiceUrl: "u" }), /Halo Kak,/);
  console.log("✓ payment status notice passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
