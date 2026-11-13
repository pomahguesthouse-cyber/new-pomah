/**
 * Pencocokan mutasi rekening (Moota) dengan bukti transfer yang tertahan.
 *
 * Mode:
 *   - proof_only: perilaku PR142 (catat dari bukti jika syarat ketat terpenuhi).
 *   - require_mutation (default bila Moota aktif): bukti valid hanya menahan
 *     status "menunggu cek mutasi"; apply setelah mutasi kredit cocok.
 *
 * Satu kandidat saja yang boleh auto-apply. Ambigu → antrean review, bukan lunas.
 * Timeout: kabari manajer, jangan auto-lunas.
 */
import {
  allowedAccountNumbers,
  extractBookingCodeFromText,
  isAllowedMootaAccount,
  isAllowedMootaBank,
  jakartaDayRange,
  mutationCoversAmount,
  mutationTimeoutMs,
  mutationWindowMs,
  parseMutationDate,
  resolvePaymentMatchMode,
  withinMutationWindow,
  type EnvLike,
  type MootaMutation,
  type PaymentMatchMode,
} from "@/lib/moota";
import {
  autoApplyPaymentProof,
  deliverPaymentApplicationNotice,
  evaluateAutoApplyEligibility,
  normalizeReference,
  threadPausedForBooking,
  type AutoApplyDeps,
  type AutoApplyOutcome,
} from "./payment-auto-apply";
import { awaitInvoiceNotification } from "./invoice-dispatch";
import type { PaymentMatchResult } from "./payment-proof-match";
import type { PaymentNoticeDeps } from "./payment-status-notice";
import { toMetaRecipient } from "./whatsapp-meta.service";

export type ProofHoldOutcome =
  | AutoApplyOutcome
  | { status: "waiting_mutation"; pendingId: string; bookingCode: string; amount: number; guestNotice: string }
  | { status: "review"; reason: string; pendingId?: string; mutationIds?: string[]; bookingCode?: string };

export interface MutationMatchDeps extends AutoApplyDeps {
  notifyGuestWaiting?: (input: {
    phone: string;
    bookingId: string;
    bookingCode: string;
    body: string;
  }) => Promise<void>;
  notifyManagers?: (alert: BankMutationAlert) => Promise<void>;
  now?: Date;
  env?: EnvLike;
}

export interface BankMutationAlert {
  kind: "review" | "timeout";
  title: string;
  body: string;
  dedupeKey: string;
  relatedId?: string | null;
}

export interface StoredMutationRow {
  mutation_id: string;
  account_number?: string | null;
  mutation_date?: string | null;
  description?: string | null;
  amount: number;
  type: string;
  match_status: string;
  bank_id?: string | null;
}

export interface PendingProofRow {
  id: string;
  message_id: string;
  booking_id: string;
  booking_code: string;
  phone: string;
  reference_no: string;
  reference_norm: string;
  amount: number;
  received_amount: number;
  kind: "dp" | "full" | "remaining";
  expected_paid: number;
  status: string;
  created_at: string;
  timeout_notified_at?: string | null;
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42883" ||
    /could not find the (function|table)|does not exist|schema cache/i.test(msg)
  );
}

export function buildWaitingMutationGuestNotice(p: {
  guestName?: string | null;
  bookingCode: string;
}): string {
  const hello = p.guestName?.trim() ? `Halo Kak ${p.guestName.trim()},` : "Halo Kak,";
  return (
    `${hello}\n\n` +
    `Bukti transfer untuk booking ${p.bookingCode} sudah kami terima. ` +
    `Saat ini kami masih menunggu konfirmasi dana masuk di rekening BCA Pomah.\n\n` +
    `Kami akan kabari Kakak lagi setelah dana terverifikasi di mutasi rekening. Terima kasih 🙏`
  );
}

export function buildMutationVerifiedNoticeFlag(): { autoRecorded: false; verifiedByMutation: true } {
  return { autoRecorded: false, verifiedByMutation: true };
}

async function loadBookingByCode(db: any, bookingCode: string) {
  const { data, error } = await db
    .from("bookings")
    .select("id, reference_code, status, payment_status, paid_amount, total_amount, guests ( phone, full_name )")
    .eq("reference_code", bookingCode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function bookingKind(paid: number, total: number, amount: number): "dp" | "full" | "remaining" | null {
  const outstanding = total - paid;
  if (amount <= 0 || outstanding <= 0) return null;
  if (Math.round(amount) === Math.round(outstanding)) return paid > 0 ? "remaining" : "full";
  if (paid === 0 && amount < total) return "dp";
  return null;
}

export async function upsertBankMutation(db: any, mutation: MootaMutation): Promise<{ inserted: boolean; row: StoredMutationRow } | { error: string; missing?: boolean }> {
  const mutationDate = parseMutationDate(mutation.date);
  const row = {
    mutation_id: mutation.mutation_id,
    account_number: mutation.account_number,
    mutation_date: mutationDate ? mutationDate.toISOString() : null,
    description: mutation.description,
    amount: mutation.amount,
    type: mutation.type,
    balance: mutation.balance,
    bank_id: mutation.bank_id,
    bank_type: mutation.bank_type,
    raw: mutation.raw,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: selErr } = await db
    .from("bank_mutations")
    .select("mutation_id, account_number, mutation_date, description, amount, type, match_status, bank_id")
    .eq("mutation_id", mutation.mutation_id)
    .maybeSingle();
  if (selErr && isMissingRelation(selErr)) return { error: selErr.message, missing: true };
  if (selErr) return { error: selErr.message };
  if (existing) return { inserted: false, row: existing as StoredMutationRow };

  const { error: insErr } = await db.from("bank_mutations").insert({
    ...row,
    match_status: mutation.type === "DB" ? "ignored_debit" : "unmatched",
    match_reason: mutation.type === "DB" ? "debit" : null,
  });
  if (insErr && /duplicate|unique/i.test(String(insErr.message ?? "") + String(insErr.code ?? ""))) {
    const again = await db
      .from("bank_mutations")
      .select("mutation_id, account_number, mutation_date, description, amount, type, match_status, bank_id")
      .eq("mutation_id", mutation.mutation_id)
      .maybeSingle();
    if (again.data) return { inserted: false, row: again.data as StoredMutationRow };
  }
  if (insErr && isMissingRelation(insErr)) return { error: insErr.message, missing: true };
  if (insErr) return { error: insErr.message };
  return {
    inserted: true,
    row: {
      mutation_id: mutation.mutation_id,
      account_number: mutation.account_number,
      mutation_date: row.mutation_date,
      description: mutation.description,
      amount: mutation.amount,
      type: mutation.type,
      match_status: mutation.type === "DB" ? "ignored_debit" : "unmatched",
      bank_id: mutation.bank_id,
    },
  };
}

async function markMutation(db: any, mutationId: string, status: string, reason: string): Promise<void> {
  const { error } = await db.rpc("mark_bank_mutation_status", {
    p_mutation_id: mutationId,
    p_status: status,
    p_reason: reason,
  });
  if (error && !isMissingRelation(error)) {
    await db.from("bank_mutations").update({
      match_status: status,
      match_reason: reason.slice(0, 300),
      updated_at: new Date().toISOString(),
    }).eq("mutation_id", mutationId).neq("match_status", "matched");
  }
}

async function listWaitingProofs(db: any): Promise<PendingProofRow[]> {
  const { data, error } = await db
    .from("payment_proof_pending")
    .select("id, message_id, booking_id, booking_code, phone, reference_no, reference_norm, amount, received_amount, kind, expected_paid, status, created_at, timeout_notified_at")
    .in("status", ["waiting_mutation", "review"]);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as PendingProofRow[];
}

async function listUnmatchedCredits(db: any): Promise<StoredMutationRow[]> {
  const { data, error } = await db
    .from("bank_mutations")
    .select("mutation_id, account_number, mutation_date, description, amount, type, match_status, bank_id")
    .eq("type", "CR")
    .in("match_status", ["unmatched", "review"]);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as StoredMutationRow[];
}

function proofsFittingMutation(
  proofs: PendingProofRow[],
  mutation: { amount: number; description?: string | null; mutation_date?: string | null },
  windowMs: number,
): PendingProofRow[] {
  const code = extractBookingCodeFromText(mutation.description);
  const amountFits = proofs.filter((p) => (
    (p.status === "waiting_mutation" || p.status === "review") &&
    mutationCoversAmount(Number(mutation.amount), Number(p.amount)) &&
    withinMutationWindow(mutation.mutation_date ?? null, p.created_at, windowMs)
  ));
  if (code) {
    const coded = amountFits.filter((p) => p.booking_code === code);
    if (coded.length) return coded;
  }
  return amountFits;
}

function mutationsFittingProof(
  mutations: StoredMutationRow[],
  proof: PendingProofRow,
  windowMs: number,
): StoredMutationRow[] {
  return mutations.filter((m) => {
    if (m.type !== "CR") return false;
    if (m.match_status === "matched" || m.match_status === "ignored_debit" || m.match_status === "ignored_account" || m.match_status === "ignored_bank") return false;
    if (!mutationCoversAmount(Number(m.amount), Number(proof.amount))) return false;
    if (!withinMutationWindow(m.mutation_date ?? null, proof.created_at, windowMs)) return false;
    const code = extractBookingCodeFromText(m.description);
    if (code && code !== proof.booking_code) return false;
    return true;
  });
}

async function applyLinked(params: {
  db: any;
  booking: any;
  phone: string;
  reference: string;
  messageId: string | null;
  amount: number;
  received: number;
  kind: "dp" | "full" | "remaining";
  expectedPaid: number;
  mutationId: string;
  pendingId?: string | null;
  deps?: MutationMatchDeps;
}): Promise<AutoApplyOutcome> {
  const { data: res, error } = await params.db.rpc("apply_payment_with_mutation", {
    p_booking_id: params.booking.id,
    p_phone: params.phone,
    p_reference: params.reference,
    p_message_id: params.messageId,
    p_amount: params.amount,
    p_received: params.received,
    p_kind: params.kind,
    p_expected_paid: params.expectedPaid,
    p_mutation_id: params.mutationId,
    p_pending_id: params.pendingId ?? null,
  });
  if (error) return isMissingRelation(error) ? { status: "not_migrated" } : { status: "error", reason: error.message };
  if (!res?.ok) return { status: "rejected", reason: String(res?.reason ?? "rpc_rejected") };

  const sync = params.deps?.syncInvoice
    ?? ((id: string) => awaitInvoiceNotification({ supabase: params.db, bookingId: id, skipWhatsApp: true } as any));
  const inv = await sync(params.booking.id).catch((e: unknown) => ({ status: "failed", reason: String(e) }));
  const notice = await deliverPaymentApplicationNotice(params.db, {
    applicationId: res.application_id,
    bookingId: params.booking.id,
    paidBefore: Number(res.paid_before),
    statusBefore: String(params.booking.payment_status ?? "unpaid"),
    appliedAmount: params.amount,
    verifiedByMutation: true,
    deps: params.deps?.notice
      ? { ...params.deps.notice }
      : undefined,
  });
  return {
    status: "applied",
    applicationId: res.application_id,
    bookingId: params.booking.id,
    paidBefore: Number(res.paid_before),
    paidAfter: Number(res.paid_after),
    total: Number(res.total),
    paymentStatus: res.status_after,
    invoice: inv.status,
    notice,
  };
}

async function insertPending(db: any, row: Omit<PendingProofRow, "id" | "status" | "created_at" | "timeout_notified_at"> & { status?: string }): Promise<{ id: string } | { error: string; missing?: boolean; existingId?: string }> {
  const payload = {
    message_id: row.message_id,
    booking_id: row.booking_id,
    booking_code: row.booking_code,
    phone: row.phone,
    reference_no: row.reference_no,
    reference_norm: row.reference_norm,
    amount: row.amount,
    received_amount: row.received_amount,
    kind: row.kind,
    expected_paid: row.expected_paid,
    status: row.status ?? "waiting_mutation",
  };
  const { data, error } = await db.from("payment_proof_pending").insert(payload).select("id").maybeSingle();
  if (error && /duplicate|unique/i.test(String(error.message ?? "") + String(error.code ?? ""))) {
    const existing = await db.from("payment_proof_pending").select("id").eq("message_id", row.message_id).maybeSingle();
    if (existing.data?.id) return { existingId: existing.data.id, error: "duplicate_message" };
  }
  if (error && isMissingRelation(error)) return { error: error.message, missing: true };
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function handleFreshPaymentProof(params: {
  supabase: any;
  phone: string;
  messageId: string;
  ocr: { nomor_referensi?: string | null; nominal?: number | null } | null;
  match: PaymentMatchResult | null;
  guestName?: string | null;
  deps?: MutationMatchDeps;
}): Promise<ProofHoldOutcome> {
  const env = params.deps?.env ?? (process.env as EnvLike);
  const mode: PaymentMatchMode = resolvePaymentMatchMode(env);
  if (mode === "proof_only") {
    return autoApplyPaymentProof({
      supabase: params.supabase,
      phone: params.phone,
      messageId: params.messageId,
      ocr: params.ocr,
      match: params.match,
      deps: params.deps,
    });
  }

  const elig = evaluateAutoApplyEligibility(params.ocr, params.match);
  if (!elig.eligible) return { status: "ineligible", reasons: elig.reasons };

  const db = params.supabase;
  try {
    const booking = await loadBookingByCode(db, elig.bookingCode!);
    if (!booking) return { status: "rejected", reason: "booking_not_found" };
    const owner = toMetaRecipient(String((booking.guests as any)?.phone ?? ""));
    if (!owner || owner !== toMetaRecipient(params.phone)) return { status: "rejected", reason: "not_owner" };
    const paid = Number(booking.paid_amount ?? 0);
    const total = Number(booking.total_amount ?? 0);
    const outstanding = total - paid;
    if (elig.kind === "dp" ? !(paid === 0 && elig.amount! < total) : Math.round(elig.amount!) !== Math.round(outstanding)) {
      return { status: "rejected", reason: "stale_match" };
    }

    const windowMs = mutationWindowMs(env);
    const unmatched = (await listUnmatchedCredits(db)).filter((m) =>
      isAllowedMootaAccount(m.account_number, env) && isAllowedMootaBank(m.bank_id, env),
    );
    const draftPending: PendingProofRow = {
      id: "",
      message_id: params.messageId,
      booking_id: booking.id,
      booking_code: elig.bookingCode!,
      phone: params.phone,
      reference_no: elig.reference!,
      reference_norm: normalizeReference(elig.reference),
      amount: elig.amount!,
      received_amount: Number(params.match?.received_amount ?? elig.amount),
      kind: elig.kind!,
      expected_paid: paid,
      status: "waiting_mutation",
      created_at: (params.deps?.now ?? new Date()).toISOString(),
    };
    const fits = mutationsFittingProof(unmatched, draftPending, windowMs);

    if (fits.length > 1) {
      const held = await insertPending(db, { ...draftPending, status: "review" });
      if ("missing" in held && held.missing) return { status: "not_migrated" };
      if ("error" in held && !("existingId" in held)) return { status: "error", reason: held.error };
      const pendingId = "id" in held ? held.id : held.existingId;
      await params.deps?.notifyManagers?.({
        kind: "review",
        title: "Mutasi ambigu — jangan auto-lunas",
        body:
          `Bukti ${elig.bookingCode} (${rp(elig.amount!)}) cocok dengan ${fits.length} mutasi.\n` +
          `Mutation: ${fits.map((m) => m.mutation_id).join(", ")}.\n` +
          `Tidak dicatat otomatis. Ketik "mutasi hari ini" atau cek dashboard.`,
        dedupeKey: `mutation_review:proof:${params.messageId}`,
        relatedId: booking.id,
      });
      return { status: "review", reason: "ambiguous_mutation", pendingId, mutationIds: fits.map((m) => m.mutation_id), bookingCode: elig.bookingCode };
    }

    if (fits.length === 1) {
      const held = await insertPending(db, draftPending);
      if ("missing" in held && held.missing) return { status: "not_migrated" };
      const pendingId = "id" in held ? held.id : held.existingId;
      return applyLinked({
        db,
        booking,
        phone: params.phone,
        reference: elig.reference!,
        messageId: params.messageId,
        amount: elig.amount!,
        received: Number(fits[0].amount),
        kind: elig.kind!,
        expectedPaid: paid,
        mutationId: fits[0].mutation_id,
        pendingId,
        deps: params.deps,
      });
    }

    const held = await insertPending(db, draftPending);
    if ("missing" in held && held.missing) return { status: "not_migrated" };
    if ("error" in held && !held.existingId) return { status: "error", reason: held.error };
    const pendingId = "id" in held ? held.id : held.existingId!;
    const guestNotice = buildWaitingMutationGuestNotice({
      guestName: String((booking.guests as any)?.full_name ?? params.guestName ?? "").trim() || null,
      bookingCode: elig.bookingCode!,
    });
    const paused = await threadPausedForBooking(db, booking.id).catch(() => false);
    if (!paused && params.deps?.notifyGuestWaiting) {
      await params.deps.notifyGuestWaiting({
        phone: params.phone,
        bookingId: booking.id,
        bookingCode: elig.bookingCode!,
        body: guestNotice,
      }).catch((e) => {
        console.warn("[mutation-match] gagal kabari tamu menunggu mutasi:", e instanceof Error ? e.message : e);
      });
    }
    return {
      status: "waiting_mutation",
      pendingId,
      bookingCode: elig.bookingCode!,
      amount: elig.amount!,
      guestNotice,
    };
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

export type ProcessMutationOutcome =
  | { status: "ignored"; reason: string; mutationId: string }
  | { status: "duplicate"; mutationId: string }
  | { status: "unmatched"; mutationId: string }
  | { status: "review"; reason: string; mutationId: string; pendingIds?: string[] }
  | { status: "applied" } & Extract<AutoApplyOutcome, { status: "applied" }>
  | { status: "rejected"; reason: string; mutationId: string }
  | { status: "not_migrated" }
  | { status: "error"; reason: string };

export async function processStoredMutation(params: {
  supabase: any;
  mutation: StoredMutationRow;
  deps?: MutationMatchDeps;
}): Promise<ProcessMutationOutcome> {
  const env = params.deps?.env ?? (process.env as EnvLike);
  const db = params.supabase;
  const mutation = params.mutation;
  try {
    if (mutation.match_status === "matched") return { status: "duplicate", mutationId: mutation.mutation_id };
    if (mutation.type !== "CR" || mutation.match_status === "ignored_debit") {
      if (mutation.match_status !== "ignored_debit") await markMutation(db, mutation.mutation_id, "ignored_debit", "debit");
      return { status: "ignored", reason: "ignored_debit", mutationId: mutation.mutation_id };
    }
    if (!isAllowedMootaAccount(mutation.account_number, env)) {
      await markMutation(db, mutation.mutation_id, "ignored_account", "wrong_account");
      return { status: "ignored", reason: "ignored_account", mutationId: mutation.mutation_id };
    }
    if (!isAllowedMootaBank(mutation.bank_id, env)) {
      await markMutation(db, mutation.mutation_id, "ignored_bank", "wrong_bank");
      return { status: "ignored", reason: "ignored_bank", mutationId: mutation.mutation_id };
    }

    const windowMs = mutationWindowMs(env);
    const proofs = proofsFittingMutation(await listWaitingProofs(db), mutation, windowMs);

    if (proofs.length > 1) {
      await markMutation(db, mutation.mutation_id, "review", `ambiguous_proofs:${proofs.length}`);
      for (const p of proofs) {
        await db.from("payment_proof_pending").update({ status: "review", match_reason: "ambiguous_mutation", updated_at: new Date().toISOString() }).eq("id", p.id).eq("status", "waiting_mutation");
      }
      await params.deps?.notifyManagers?.({
        kind: "review",
        title: "Mutasi ambigu — jangan auto-lunas",
        body:
          `Mutasi ${mutation.mutation_id} ${rp(Number(mutation.amount))} cocok dengan ${proofs.length} bukti: ` +
          `${proofs.map((p) => p.booking_code).join(", ")}.\nTidak dicatat otomatis.`,
        dedupeKey: `mutation_review:mut:${mutation.mutation_id}`,
        relatedId: mutation.mutation_id,
      });
      return { status: "review", reason: "ambiguous_proofs", mutationId: mutation.mutation_id, pendingIds: proofs.map((p) => p.id) };
    }

    if (proofs.length === 1) {
      const proof = proofs[0];
      const booking = await loadBookingByCode(db, proof.booking_code);
      if (!booking) return { status: "rejected", reason: "booking_not_found", mutationId: mutation.mutation_id };
      const applied = await applyLinked({
        db,
        booking,
        phone: proof.phone,
        reference: proof.reference_no,
        messageId: proof.message_id,
        amount: Number(proof.amount),
        received: Number(mutation.amount),
        kind: proof.kind,
        expectedPaid: Number(proof.expected_paid),
        mutationId: mutation.mutation_id,
        pendingId: proof.id,
        deps: params.deps,
      });
      if (applied.status === "applied") return { ...applied, status: "applied" };
      if (applied.status === "not_migrated") return applied;
      return { status: "rejected", reason: applied.status === "rejected" ? applied.reason : applied.status === "error" ? applied.reason : applied.status, mutationId: mutation.mutation_id };
    }

    // Mutasi datang dulu: jika berita transfer memuat kode booking unik + nominal cocok.
    const code = extractBookingCodeFromText(mutation.description);
    if (code) {
      const booking = await loadBookingByCode(db, code);
      if (booking && !["cancelled", "expired", "checked_out"].includes(String(booking.status))) {
        const paid = Number(booking.paid_amount ?? 0);
        const total = Number(booking.total_amount ?? 0);
        const outstanding = total - paid;
        let amount = outstanding > 0 && mutationCoversAmount(Number(mutation.amount), outstanding) ? outstanding : null;
        let kind = amount != null ? bookingKind(paid, total, amount) : null;
        if (amount == null && paid === 0 && total > 0) {
          // DP: mutasi menutup sebagian tagihan (bukan sisa penuh).
          const maybeDp = Number(mutation.amount) <= total && Number(mutation.amount) > 0;
          // Hanya auto-DP jika mutasi tepat menutup expected DP? Kita tetap
          // konservatif: tanpa bukti, hanya lunas/sisa yang auto. DP tanpa
          // bukti mudah salah. Jadi tidak auto-DP di jalur kode saja.
          void maybeDp;
        }
        if (amount != null && kind && (kind === "full" || kind === "remaining")) {
          const phone = String((booking.guests as any)?.phone ?? "");
          const applied = await applyLinked({
            db,
            booking,
            phone,
            reference: mutation.mutation_id,
            messageId: null,
            amount,
            received: Number(mutation.amount),
            kind,
            expectedPaid: paid,
            mutationId: mutation.mutation_id,
            deps: params.deps,
          });
          if (applied.status === "applied") return { ...applied, status: "applied" };
          if (applied.status === "not_migrated") return applied;
          return { status: "rejected", reason: applied.status === "rejected" ? applied.reason : "apply_failed", mutationId: mutation.mutation_id };
        }
      }
    }

    if (mutation.match_status === "review") return { status: "review", reason: "still_review", mutationId: mutation.mutation_id };
    return { status: "unmatched", mutationId: mutation.mutation_id };
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function ingestMootaMutations(params: {
  supabase: any;
  mutations: MootaMutation[];
  deps?: MutationMatchDeps;
}): Promise<{ stored: number; applied: number; review: number; ignored: number; errors: number; missing?: boolean }> {
  const summary = { stored: 0, applied: 0, review: 0, ignored: 0, errors: 0, missing: false as boolean | undefined };
  const env = params.deps?.env ?? (process.env as EnvLike);
  // Jika mode proof_only, tetap simpan mutasi (audit) tetapi jangan auto-apply.
  const mode = resolvePaymentMatchMode(env);
  for (const mutation of params.mutations) {
    const upserted = await upsertBankMutation(params.supabase, mutation);
    if ("error" in upserted) {
      if (upserted.missing) summary.missing = true;
      summary.errors++;
      continue;
    }
    if (upserted.inserted) summary.stored++;
    if (mode === "proof_only") continue;
    const result = await processStoredMutation({
      supabase: params.supabase,
      mutation: upserted.row,
      deps: params.deps,
    });
    if (result.status === "applied") summary.applied++;
    else if (result.status === "review") summary.review++;
    else if (result.status === "ignored" || result.status === "duplicate") summary.ignored++;
    else if (result.status === "error" || result.status === "not_migrated") summary.errors++;
  }
  return summary;
}

export async function expireWaitingProofs(params: {
  supabase: any;
  deps?: MutationMatchDeps;
}): Promise<{ notified: number }> {
  const env = params.deps?.env ?? (process.env as EnvLike);
  const timeoutMs = mutationTimeoutMs(env);
  const now = params.deps?.now ?? new Date();
  const cutoff = new Date(now.getTime() - timeoutMs).toISOString();
  const { data, error } = await params.supabase
    .from("payment_proof_pending")
    .select("id, booking_code, amount, created_at, timeout_notified_at, phone, booking_id")
    .eq("status", "waiting_mutation")
    .is("timeout_notified_at", null)
    .lt("created_at", cutoff)
    .limit(20);
  if (error) {
    if (isMissingRelation(error)) return { notified: 0 };
    throw error;
  }
  let notified = 0;
  for (const row of data ?? []) {
    await params.deps?.notifyManagers?.({
      kind: "timeout",
      title: "Bukti transfer belum ketemu mutasi",
      body:
        `Bukti ${row.booking_code} (${rp(Number(row.amount))}) masih menunggu cek mutasi sejak ${row.created_at}.\n` +
        `Tidak dicatat otomatis. Cek mutasi BCA atau ketik "mutasi hari ini".`,
      dedupeKey: `mutation_timeout:${row.id}`,
      relatedId: row.booking_id,
    });
    const { error: updErr } = await params.supabase
      .from("payment_proof_pending")
      .update({ timeout_notified_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", row.id)
      .is("timeout_notified_at", null);
    if (!updErr) notified++;
  }
  return { notified };
}

export function formatTodayBankMutations(rows: StoredMutationRow[], now: Date = new Date()): string {
  const { label } = jakartaDayRange(now);
  if (!rows.length) return `Tidak ada mutasi rekening tercatat untuk hari ini (${label}).`;
  const lines = [`Mutasi BCA ${label}:`, ""];
  const statusLabel: Record<string, string> = {
    matched: "sudah dicocokkan",
    unmatched: "menunggu bukti / belum cocok",
    review: "perlu ditinjau (ambigu)",
    ignored_debit: "debit (diabaikan)",
    ignored_account: "bukan rekening Pomah",
    ignored_bank: "bukan bank yang dikonfigurasi",
  };
  for (const row of rows) {
    const when = row.mutation_date
      ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(row.mutation_date))
      : "--:--";
    const desc = String(row.description ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(
      `• ${when} ${row.type} ${rp(Number(row.amount))}` +
        (desc ? ` — ${desc}` : "") +
        ` — ${statusLabel[row.match_status] ?? row.match_status}`,
    );
  }
  const accounts = allowedAccountNumbers();
  if (accounts.length) lines.push("", `Rekening dipantau: ${accounts.join(", ")}`);
  return lines.join("\n");
}

export async function loadTodayBankMutations(db: any, now: Date = new Date()): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const { startIso, endIso, label } = jakartaDayRange(now);
  const { data, error } = await db
    .from("bank_mutations")
    .select("mutation_id, account_number, mutation_date, description, amount, type, match_status, bank_id")
    .gte("mutation_date", startIso)
    .lt("mutation_date", endIso)
    .order("mutation_date", { ascending: true })
    .limit(50);
  if (error) {
    if (isMissingRelation(error)) {
      return { ok: false, text: `Tabel mutasi belum dipasang (SQL 20261113). Tidak ada data untuk ${label}.` };
    }
    return { ok: false, text: `Gagal memuat mutasi: ${error.message}` };
  }
  return { ok: true, text: formatTodayBankMutations((data ?? []) as StoredMutationRow[], now) };
}

export async function maintainBankMutationPipeline(db: any, deps?: MutationMatchDeps): Promise<{
  timeouts: number;
  retriedUnmatched: number;
}> {
  const timeouts = await expireWaitingProofs({ supabase: db, deps }).catch(() => ({ notified: 0 }));
  // Coba ulang mutasi unmatched terbaru (jika webhook tersimpan tapi match sempat gagal).
  const { data } = await db
    .from("bank_mutations")
    .select("mutation_id, account_number, mutation_date, description, amount, type, match_status, bank_id")
    .eq("type", "CR")
    .eq("match_status", "unmatched")
    .order("created_at", { ascending: false })
    .limit(20);
  let retriedUnmatched = 0;
  for (const row of data ?? []) {
    const result = await processStoredMutation({ supabase: db, mutation: row as StoredMutationRow, deps });
    if (result.status === "applied" || result.status === "review") retriedUnmatched++;
  }
  return { timeouts: timeouts.notified, retriedUnmatched };
}
