/**
 * Pencatatan pembayaran OTOMATIS dari bukti transfer yang cocok ketat.
 *
 * Disetujui Faizal (8 Nov 2026): catat otomatis bila nominal, rekening tujuan,
 * satu booking, dan referensi belum dipakai cocok — meski BELUM ada verifikasi
 * mutasi bank (risiko diterima: bukti palsu yang lolos OCR bisa tercatat).
 * Lunas bila kumulatif ≥ total; selain itu DP (partial).
 *
 * Sumber kebenaran: hasil OCR + pencocokan deterministik (bukan klaim LLM).
 * Semua yang tidak memenuhi syarat → tetap ke staf (alur lama).
 *
 * Atomisitas ada di DB (supabase/manual/20261108_payment_applications.sql):
 *   apply_payment_proof — kunci baris booking (FOR UPDATE), cek paid_amount
 *   tidak berubah, INSERT dengan UNIQUE(reference_norm) & UNIQUE(source_message_id),
 *   update paid_amount/payment_status (total tidak disentuh) dalam satu transaksi.
 *   claim_payment_notice / finish_payment_notice — outbox notifikasi atomik.
 * Bila RPC belum ada (migrasi belum dijalankan) → fail-safe ke staf.
 */
import type { PaymentMatchResult } from "./payment-proof-match";
import { awaitInvoiceNotification } from "./invoice-dispatch";
import { notifyPaymentStatusChange, type PaymentNoticeDeps } from "./payment-status-notice";
import { toMetaRecipient } from "./whatsapp-meta.service";

const KIND_BY_STATUS: Record<string, "full" | "dp" | "remaining"> = {
  matched_full: "full",
  matched_dp: "dp",
  matched_remaining: "remaining",
};

export function normalizeReference(ref: unknown): string {
  return String(ref ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export interface AutoApplyEligibility {
  eligible: boolean;
  reasons: string[];
  kind?: "full" | "dp" | "remaining";
  amount?: number;
  fee?: number;
  bookingCode?: string;
  reference?: string;
}

/** Murni. Syarat ketat; semua alasan penolakan dikumpulkan. */
export function evaluateAutoApplyEligibility(
  ocr: { nomor_referensi?: string | null } | null | undefined,
  match: PaymentMatchResult | null | undefined,
): AutoApplyEligibility {
  const reasons: string[] = [];
  if (!ocr || !match) return { eligible: false, reasons: ["no_ocr"] };
  const kind = KIND_BY_STATUS[match.status];
  if (!kind) reasons.push(`status_${match.status}`);
  if (match.destination_ok !== true) reasons.push("wrong_recipient");
  if (match.candidate_fit_count !== 1) reasons.push("ambiguous_booking");
  if (!match.booking_code) reasons.push("no_booking");
  const ref = String(ocr.nomor_referensi ?? "").trim();
  if (normalizeReference(ref).length < 6) reasons.push("missing_reference");
  const amount = Number(match.expected_amount ?? 0);
  if (!(amount > 0)) reasons.push("invalid_amount");
  const fee = Math.max(0, Number(match.transfer_fee_surplus ?? 0));
  const received = Number(match.received_amount ?? 0);
  // Kurang bayar tidak pernah lolos; lebih hanya ≤ 6.500 (biaya transfer).
  if (amount > 0 && (received < amount || received - amount > 6500)) reasons.push("amount_mismatch");
  if (reasons.length) return { eligible: false, reasons };
  return { eligible: true, reasons, kind, amount, fee, bookingCode: match.booking_code!, reference: ref };
}

export type AutoApplyOutcome =
  | { status: "applied"; applicationId: string; bookingId: string; paidBefore: number; paidAfter: number; total: number; paymentStatus: "partial" | "paid"; invoice: string; notice: string }
  | { status: "ineligible"; reasons: string[] }
  | { status: "rejected"; reason: string }
  | { status: "not_migrated" }
  | { status: "error"; reason: string };

export interface AutoApplyDeps {
  syncInvoice?: (bookingId: string) => Promise<{ status: string; reason?: string }>;
  notice?: PaymentNoticeDeps;
}

function isMissingRpc(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(msg);
}

export async function autoApplyPaymentProof(params: {
  supabase: any;
  phone: string;
  messageId: string;
  ocr: { nomor_referensi?: string | null } | null;
  match: PaymentMatchResult | null;
  deps?: AutoApplyDeps;
}): Promise<AutoApplyOutcome> {
  const elig = evaluateAutoApplyEligibility(params.ocr, params.match);
  if (!elig.eligible) return { status: "ineligible", reasons: elig.reasons };
  const db = params.supabase;
  try {
    // Kepemilikan: booking harus milik nomor pengirim bukti.
    const { data: b, error } = await db
      .from("bookings")
      .select("id, reference_code, status, payment_status, paid_amount, total_amount, guests ( phone )")
      .eq("reference_code", elig.bookingCode)
      .maybeSingle();
    if (error) return { status: "error", reason: error.message };
    if (!b) return { status: "rejected", reason: "booking_not_found" };
    const owner = toMetaRecipient(String((b.guests as any)?.phone ?? ""));
    if (!owner || owner !== toMetaRecipient(params.phone)) return { status: "rejected", reason: "not_owner" };
    const paid = Number(b.paid_amount ?? 0);
    const total = Number(b.total_amount ?? 0);
    const outstanding = total - paid;
    // Konsistensi pencocokan vs DB saat ini (cegah DP dari data basi).
    if (elig.kind === "dp" ? !(paid === 0 && elig.amount! < total) : Math.round(elig.amount!) !== Math.round(outstanding)) {
      return { status: "rejected", reason: "stale_match" };
    }

    const { data: res, error: rpcErr } = await db.rpc("apply_payment_proof", {
      p_booking_id: b.id,
      p_phone: params.phone,
      p_reference: elig.reference,
      p_message_id: params.messageId,
      p_amount: elig.amount,
      // Nominal diterima aktual: DB hanya menoleransi LEBIH ≤ 6.500 (biaya
      // transfer), tidak pernah kurang.
      p_received: Number(params.match?.received_amount ?? 0),
      p_kind: elig.kind,
      p_expected_paid: paid,
    });
    if (rpcErr) return isMissingRpc(rpcErr) ? { status: "not_migrated" } : { status: "error", reason: rpcErr.message };
    if (!res?.ok) return { status: "rejected", reason: String(res?.reason ?? "rpc_rejected") };

    // Commit sudah durable. Sinkron invoice (snapshot/PDF) lalu notifikasi tamu.
    const sync = params.deps?.syncInvoice
      ?? ((id: string) => awaitInvoiceNotification({ supabase: db, bookingId: id, skipWhatsApp: true } as any));
    const inv = await sync(b.id).catch((e: unknown) => ({ status: "failed", reason: String(e) }));
    const notice = await deliverPaymentApplicationNotice(db, {
      applicationId: res.application_id,
      bookingId: b.id,
      paidBefore: Number(res.paid_before),
      statusBefore: String(b.payment_status ?? "unpaid"),
      appliedAmount: elig.amount!,
      deps: params.deps?.notice,
    });
    return {
      status: "applied",
      applicationId: res.application_id,
      bookingId: b.id,
      paidBefore: Number(res.paid_before),
      paidAfter: Number(res.paid_after),
      total: Number(res.total),
      paymentStatus: res.status_after,
      invoice: inv.status,
      notice,
    };
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Klaim atomik → kirim → tandai. Gagal → status failed, dicoba ulang cron. */
export async function deliverPaymentApplicationNotice(
  db: any,
  p: { applicationId: string; bookingId: string; paidBefore: number; statusBefore: string; appliedAmount: number; deps?: PaymentNoticeDeps },
): Promise<"sent" | "not_claimed" | "failed" | "skipped" | "deferred_staff_pause"> {
  // Hormati jeda staf per-thread: jangan klaim; tetap pending untuk cron
  // (yang juga mengecek jeda), jadi tidak ada bypass jeda global.
  const paused = await (p.deps?.isPaused ?? ((id: string) => threadPausedForBooking(db, id)))(p.bookingId).catch(() => false);
  if (paused) return "deferred_staff_pause";
  // Lease + token: klaim ganda ditolak; worker basi tidak bisa menimpa hasil.
  // At-least-once: crash setelah kirim sebelum finish → bisa terkirim ulang
  // setelah lease habis (exactly-once ke Meta tidak bisa dijamin).
  const { data: token, error } = await db.rpc("claim_payment_notice", { p_application_id: p.applicationId });
  if (error || !token) return "not_claimed";
  const out = await notifyPaymentStatusChange({
    supabase: db,
    bookingId: p.bookingId,
    before: { payment_status: p.statusBefore, paid_amount: p.paidBefore },
    deps: p.deps,
    appliedAmount: p.appliedAmount,
    autoRecorded: true,
    skipDedup: true,
  });
  await db.rpc("finish_payment_notice", {
    p_application_id: p.applicationId,
    p_claim_token: token,
    p_outcome: out.status,
    p_error: out.status === "failed" ? out.reason : out.status === "skipped" ? out.reason : null,
  });
  return out.status === "sent" ? "sent" : out.status === "skipped" ? "skipped" : "failed";
}

export async function threadPausedForBooking(db: any, bookingId: string): Promise<boolean> {
  const { data: b } = await db.from("bookings").select("guests ( phone )").eq("id", bookingId).maybeSingle();
  const phone = toMetaRecipient(String((b?.guests as any)?.phone ?? ""));
  if (!phone) return false;
  const { data: t } = await db
    .from("whatsapp_threads")
    .select("ai_auto, ai_paused_until")
    .eq("phone", phone)
    .maybeSingle();
  if (!t) return false;
  if (t.ai_auto === false) return true;
  return !!t.ai_paused_until && Date.parse(t.ai_paused_until) > Date.now();
}

/** Dipanggil cron: kirim ulang notifikasi pending/failed (maks 5 percobaan di DB). */
export async function retryPendingPaymentNotices(db: any, deps?: AutoApplyDeps): Promise<{ retried: number }> {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data, error } = await db
    .from("payment_applications")
    .select("id, booking_id, paid_before, amount, notice_status")
    .in("notice_status", ["pending", "failed", "sending"])
    .lt("created_at", cutoff)
    .lt("notice_attempts", 5)
    .limit(5);
  if (error || !data) return { retried: 0 };
  let retried = 0;
  for (const row of data as any[]) {
    const sync = deps?.syncInvoice
      ?? ((id: string) => awaitInvoiceNotification({ supabase: db, bookingId: id, skipWhatsApp: true } as any));
    await sync(row.booking_id).catch(() => null);
    const r = await deliverPaymentApplicationNotice(db, {
      applicationId: row.id,
      bookingId: row.booking_id,
      paidBefore: Number(row.paid_before),
      statusBefore: Number(row.paid_before) > 0 ? "partial" : "unpaid",
      appliedAmount: Number(row.amount),
      deps: deps?.notice,
    });
    if (r !== "not_claimed") retried++;
  }
  return { retried };
}
