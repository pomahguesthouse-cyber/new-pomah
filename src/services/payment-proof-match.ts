/**
 * Pencocokan bukti transfer dengan booking terbuka.
 *
 * OCR sudah mengekstrak angka. Modul ini hanya memutuskan apakah nominal
 * yang DITERIMA hotel (tanpa biaya admin bank pengirim) masuk akal sebagai
 * DP 50%, pelunasan, atau sisa tagihan. Tidak menulis status pembayaran.
 */

import { OFFICIAL_TRANSFER_ACCOUNT } from "@/lib/payment-account";

export type PaymentMatchStatus =
  | "matched_dp"
  | "matched_full"
  | "matched_remaining"
  | "partial"
  | "overpaid"
  | "unmatched"
  | "no_pending_booking";

export interface PaymentProofOcrInput {
  bank_pengirim?: string | null;
  bank_tujuan?: string | null;
  nominal?: number | null;
  biaya_admin?: number | null;
  total_dibayar?: number | null;
  tanggal?: string | null;
  nama_pengirim?: string | null;
  nomor_referensi?: string | null;
  raw_text?: string | null;
  /** Opsional. Tidak wajib dari OCR; ikut discan bila ada. */
  nama_penerima?: string | null;
  rekening_tujuan?: string | null;
}

export interface PaymentMatchCandidate {
  bookingCode: string;
  total: number;
  paid?: number | null;
  nights?: number | null;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  roomTypes?: string[] | null;
  createdAt?: string | null;
  source?: "booking" | "draft";
}

export interface PaymentMatchResult {
  status: PaymentMatchStatus;
  booking_code: string | null;
  /** Total tagihan booking yang dipilih. Dipertahankan untuk pembaca lama. */
  booking_amount: number | null;
  /** Angka yang dipakai sebagai patokan (DP, sisa, atau total). */
  expected_amount: number | null;
  /** nominal diterima − expected_amount. */
  amount_diff: number | null;
  match_reason: string;
  destination_ok: boolean;
  summary: string;
  received_amount: number | null;
  dp_amount: number | null;
  remaining_amount: number | null;
  /**
   * Kelebihan transfer (Rp) pada hasil cocok, biasanya biaya transfer yang ikut
   * ditambahkan tamu. Null bila tidak cocok atau nominal tidak lebih.
   */
  transfer_fee_surplus: number | null;
}

/**
 * Batas kelebihan transfer yang tetap dianggap cocok: biaya BI-FAST Rp2.500
 * dan transfer antarbank biasa Rp6.500 yang ikut ditambahkan tamu.
 * Kekurangan bayar tetap memakai toleransi kecil (paymentAmountTolerance).
 */
export const TRANSFER_FEE_SURPLUS_TOLERANCE = 6500;

const DRAFT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const GENERIC_ROOM_TOKENS = new Set([
  "room",
  "rooms",
  "kamar",
  "tipe",
  "type",
  "hotel",
  "guest",
  "house",
  "guesthouse",
]);

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveRupiah(value: unknown): number | null {
  const parsed = money(value);
  if (parsed == null || parsed <= 0) return null;
  return Math.round(parsed);
}

/**
 * Jumlah yang sampai ke hotel.
 * Utamakan `nominal`. Bila kosong: total didebit dikurangi biaya admin, lalu total didebit.
 */
export function receivedTransferAmount(ocr: PaymentProofOcrInput | null | undefined): number | null {
  if (!ocr) return null;
  const nominal = positiveRupiah(ocr.nominal);
  if (nominal != null) return nominal;
  const total = positiveRupiah(ocr.total_dibayar);
  const fee = positiveRupiah(ocr.biaya_admin);
  if (total != null && fee != null && total - fee > 0) return total - fee;
  return total;
}

/**
 * Toleransi kecil (lebih atau kurang): yang lebih besar antara Rp1.000 dan 0,5%.
 * Kelebihan karena biaya transfer ditangani terpisah lewat TRANSFER_FEE_SURPLUS_TOLERANCE.
 */
export function paymentAmountTolerance(expected: number): number {
  const rounded = Math.round(expected);
  if (!Number.isFinite(rounded) || rounded <= 0) return 1000;
  const halfPercent = Math.round((rounded * 5) / 1000);
  return Math.max(1000, halfPercent);
}

export function paymentAmountsClose(received: number, expected: number): boolean {
  if (!(received > 0) || !(expected > 0)) return false;
  const left = Math.round(received);
  const right = Math.round(expected);
  return Math.abs(left - right) <= paymentAmountTolerance(right);
}

export type PaymentAmountFit = "exact" | "tolerance" | "transfer_fee";

/**
 * Seberapa cocok nominal diterima dengan angka yang diharapkan.
 * - exact: sama persis
 * - tolerance: selisih dalam max(Rp1.000, 0,5%), lebih atau kurang
 * - transfer_fee: LEBIH sampai TRANSFER_FEE_SURPLUS_TOLERANCE (biaya transfer ikut ditambahkan)
 * Kurang bayar di luar toleransi kecil → null.
 */
export function paymentAmountFit(received: number, expected: number): PaymentAmountFit | null {
  if (!(received > 0) || !(expected > 0)) return null;
  const left = Math.round(received);
  const right = Math.round(expected);
  const diff = left - right;
  if (diff === 0) return "exact";
  if (Math.abs(diff) <= paymentAmountTolerance(right)) return "tolerance";
  if (diff > 0 && diff <= TRANSFER_FEE_SURPLUS_TOLERANCE) return "transfer_fee";
  return null;
}

export function formatRpCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp${grouped}`;
}

function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function previousDay(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn?: string | null, checkOut?: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const start = Date.parse(`${checkIn.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86400000);
}

export function stayNights(candidate: PaymentMatchCandidate): number | null {
  const explicit = money(candidate.nights);
  if (explicit != null && explicit > 0) return Math.round(explicit);
  return nightsBetween(candidate.checkIn, candidate.checkOut);
}

export function remainingBalance(candidate: PaymentMatchCandidate): number {
  if (String(candidate.paymentStatus ?? "").toLowerCase() === "paid") return 0;
  const total = positiveRupiah(candidate.total) ?? 0;
  const paidRaw = money(candidate.paid);
  const paid = paidRaw != null && paidRaw > 0 ? Math.round(paidRaw) : 0;
  return Math.max(0, total - paid);
}

export function minimumCheckoutDate(now: Date = new Date()): string {
  return previousDay(wibDate(now));
}

export function isOpenPaymentCandidate(
  candidate: PaymentMatchCandidate,
  now: Date = new Date(),
): boolean {
  const status = String(candidate.status ?? "").trim().toLowerCase();
  if (status === "cancelled") return false;
  if (candidate.source === "draft") {
    if (status && status !== "draft" && status !== "failed") return false;
    const created = Date.parse(candidate.createdAt ?? "");
    if (!Number.isFinite(created) || created < now.getTime() - DRAFT_LOOKBACK_MS) return false;
  }
  const checkout = String(candidate.checkOut ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return false;
  if (checkout < minimumCheckoutDate(now)) return false;
  if ((positiveRupiah(candidate.total) ?? 0) <= 0) return false;
  return remainingBalance(candidate) > 0;
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function destinationBlob(ocr: PaymentProofOcrInput): string {
  return [ocr.bank_tujuan, ocr.rekening_tujuan, ocr.nama_penerima, ocr.raw_text]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

function officialAccountSeen(text: string): boolean {
  const digits = text.replace(/\D/g, "");
  if (digits.includes(OFFICIAL_TRANSFER_ACCOUNT.accountNumber)) return true;
  const tokens = text.match(/\d[\d\s.\-]{3,}\d/g) ?? [];
  return tokens.some((token) => token.replace(/\D/g, "").replace(/^0+/, "") === "95584379");
}

function officialNameSeen(text: string): boolean {
  const folded = foldText(text).replace(/[^A-Z]/g, "");
  return folded.includes("FAIZALABDURACHMAN");
}

function bankLabel(text: string): "bca" | "other" | "unknown" {
  if (/\bBCA\b/i.test(text)) return "bca";
  if (/\b(MANDIRI|BNI|BRI|BSI|CIMB|PERMATA|DANAMON|BTN|SEABANK|JAGO|OCBC|BJB)\b/i.test(text)) {
    return "other";
  }
  return "unknown";
}

/**
 * Rekening Pomah: BCA dan (nomor 0095584379 atau nama Faizal Abdurachman).
 * Bank lain yang disebut eksplisit tidak lolos, meski namanya mirip.
 */
export function paymentDestinationOk(ocr: PaymentProofOcrInput | null | undefined): boolean {
  if (!ocr) return false;
  const blob = destinationBlob(ocr);
  if (!blob.trim()) return false;
  const account = officialAccountSeen(blob);
  const name = officialNameSeen(blob);
  const bank = bankLabel(`${ocr.bank_tujuan ?? ""}\n${blob}`);
  if (bank === "other" && !account) return false;
  if (account && bank !== "other") return true;
  if (name && (bank === "bca" || bank === "unknown")) return true;
  return false;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const prev = new Array<number>(right.length + 1);
  const next = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = next[j];
  }
  return prev[right.length];
}

export function roomTypeMentioned(roomTypes: string[] | null | undefined, note: string): boolean {
  const haystack = (note ?? "").toLowerCase();
  if (!haystack.trim() || !roomTypes?.length) return false;
  const noteTokens = haystack.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const noteAlpha = haystack.replace(/[^a-z0-9]+/g, "");
  for (const label of roomTypes) {
    const tokens = label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !GENERIC_ROOM_TOKENS.has(token));
    for (const token of tokens) {
      if (noteAlpha.includes(token)) return true;
      const maxDistance = token.length >= 6 ? 2 : 1;
      for (const noteToken of noteTokens) {
        if (Math.abs(noteToken.length - token.length) > maxDistance) continue;
        if (levenshtein(token, noteToken) <= maxDistance) return true;
      }
    }
  }
  return false;
}

interface Expectation {
  kind: "dp" | "full" | "remaining";
  amount: number;
}

function expectationsFor(candidate: PaymentMatchCandidate): Expectation[] {
  const total = positiveRupiah(candidate.total) ?? 0;
  const paidRaw = money(candidate.paid);
  const paid = paidRaw != null && paidRaw > 0 ? Math.round(paidRaw) : 0;
  const remaining = remainingBalance(candidate);
  const nights = stayNights(candidate);
  const list: Expectation[] = [];
  if (nights != null && nights >= 2 && total > 0) {
    list.push({ kind: "dp", amount: Math.round(total / 2) });
  }
  if (remaining > 0) list.push({ kind: "remaining", amount: remaining });
  if (total > 0) list.push({ kind: "full", amount: total });
  return list;
}

function kindRank(kind: Expectation["kind"], paid: number): number {
  if (paid > 0 && kind === "remaining") return 0;
  if (kind === "full") return 1;
  if (kind === "dp") return 2;
  return 3;
}

function createdMillis(candidate: PaymentMatchCandidate): number {
  const parsed = Date.parse(candidate.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

interface BookingFit {
  candidate: PaymentMatchCandidate;
  expectation: Expectation;
  diff: number;
  exact: boolean;
  /** Cocok hanya karena kelebihan biaya transfer (di luar toleransi kecil). */
  feeOnly: boolean;
  room: boolean;
  createdAt: number;
  index: number;
}

function paidOf(candidate: PaymentMatchCandidate): number {
  const paid = money(candidate.paid);
  return paid != null && paid > 0 ? Math.round(paid) : 0;
}

function bestFitForBooking(
  candidate: PaymentMatchCandidate,
  received: number,
  note: string,
  index: number,
): BookingFit | null {
  const hits = expectationsFor(candidate)
    .map((expectation) => ({ expectation, fit: paymentAmountFit(received, expectation.amount) }))
    .filter((hit): hit is { expectation: Expectation; fit: PaymentAmountFit } => hit.fit != null)
    .map(({ expectation, fit }) => {
      const diff = received - expectation.amount;
      return { expectation, diff, exact: fit === "exact", feeOnly: fit === "transfer_fee" };
    });
  if (hits.length === 0) return null;
  hits.sort((left, right) => {
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    if (left.feeOnly !== right.feeOnly) return left.feeOnly ? 1 : -1;
    const distance = Math.abs(left.diff) - Math.abs(right.diff);
    if (distance !== 0) return distance;
    return kindRank(left.expectation.kind, paidOf(candidate)) - kindRank(right.expectation.kind, paidOf(candidate));
  });
  const winner = hits[0];
  return {
    candidate,
    expectation: winner.expectation,
    diff: winner.diff,
    exact: winner.exact,
    feeOnly: winner.feeOnly,
    room: roomTypeMentioned(candidate.roomTypes, note),
    createdAt: createdMillis(candidate),
    index,
  };
}

function statusFor(kind: Expectation["kind"], candidate: PaymentMatchCandidate): PaymentMatchStatus {
  if (kind === "dp") return "matched_dp";
  if (kind === "remaining" && paidOf(candidate) > 0 && remainingBalance(candidate) < (positiveRupiah(candidate.total) ?? 0)) {
    return "matched_remaining";
  }
  return "matched_full";
}

function referenceCandidate(candidates: PaymentMatchCandidate[], note: string): PaymentMatchCandidate {
  const mentioned = candidates.filter((candidate) => roomTypeMentioned(candidate.roomTypes, note));
  const pool = mentioned.length > 0 ? mentioned : candidates;
  return [...pool].sort((left, right) => createdMillis(right) - createdMillis(left))[0];
}

function closestExpectation(candidate: PaymentMatchCandidate, received: number): Expectation | null {
  const list = expectationsFor(candidate);
  if (list.length === 0) return null;
  return list.reduce((best, item) =>
    Math.abs(received - item.amount) < Math.abs(received - best.amount) ? item : best,
  );
}

function classifyMiss(candidate: PaymentMatchCandidate, received: number): PaymentMatchStatus {
  const list = expectationsFor(candidate);
  if (list.length === 0) return "unmatched";
  const maxAmount = Math.max(...list.map((item) => item.amount));
  const belowAll = list.every((item) => received < item.amount && paymentAmountFit(received, item.amount) == null);
  const aboveAll = received > maxAmount && paymentAmountFit(received, maxAmount) == null;
  if (aboveAll) return "overpaid";
  if (belowAll) return "partial";
  return "unmatched";
}

export interface PaymentMatchSummaryInput {
  status?: string | null;
  booking_code?: string | null;
  booking_amount?: number | null;
  expected_amount?: number | null;
  received_amount?: number | null;
  dp_amount?: number | null;
  remaining_amount?: number | null;
  amount_diff?: number | null;
  transfer_fee_surplus?: number | null;
}

/** "lebih Rp2.500, kemungkinan biaya transfer" bila nominal cocok tapi sedikit lebih. */
export function transferFeeSurplusNote(surplus: number | null | undefined): string {
  if (surplus == null || !Number.isFinite(surplus) || surplus <= 0) return "";
  return `lebih ${formatRpCompact(surplus)}, kemungkinan biaya transfer`;
}

function matchedSurplus(match: PaymentMatchSummaryInput): number | null {
  const explicit = match.transfer_fee_surplus;
  if (explicit != null && Number.isFinite(explicit)) return explicit > 0 ? Math.round(explicit) : null;
  const diff = match.amount_diff;
  if (diff != null && Number.isFinite(diff) && diff > 0 && diff <= TRANSFER_FEE_SURPLUS_TOLERANCE) {
    return Math.round(diff);
  }
  return null;
}

function amountWithSurplus(amount: number, match: PaymentMatchSummaryInput): string {
  const note = transferFeeSurplusNote(matchedSurplus(match));
  return note ? `${formatRpCompact(amount)}, ${note}` : formatRpCompact(amount);
}

export function formatPaymentProofSummary(match: PaymentMatchSummaryInput | null | undefined): string {
  if (!match) return "";
  const code = match.booking_code || null;
  const received = match.received_amount ?? null;
  const expected = match.expected_amount ?? null;
  const status = match.status;
  if (status === "matched_dp" && code && expected != null) {
    return `Cocok DP 50% ${code} (${amountWithSurplus(expected, match)})`;
  }
  if (status === "matched_full" && code && expected != null) {
    return `Cocok lunas ${code} (${amountWithSurplus(expected, match)})`;
  }
  if (status === "matched_remaining" && code && expected != null) {
    return `Cocok sisa ${code} (${amountWithSurplus(expected, match)})`;
  }
  if (status === "matched") {
    const amount = expected ?? match.booking_amount ?? null;
    return amount != null && code ? `Cocok ${code} (${formatRpCompact(amount)})` : `Cocok ${code ?? "-"}`;
  }
  if (status === "no_pending_booking") {
    return received != null
      ? `Tidak ada booking terbuka untuk transfer ${formatRpCompact(received)}`
      : "Tidak ada booking terbuka untuk dicocokkan";
  }
  if (received == null && code) {
    return `Nominal tidak terbaca; booking ${code} belum dicocokkan`;
  }
  if (received == null) return "Nominal tidak terbaca";
  if (!code) return `Belum cocok: transfer ${formatRpCompact(received)}`;
  if (status === "overpaid") {
    const total = match.booking_amount ?? expected;
    return `Lebih bayar: transfer ${formatRpCompact(received)}, booking ${code} total ${formatRpCompact(total)}`;
  }
  const dp = match.dp_amount ?? null;
  const remaining = match.remaining_amount ?? match.booking_amount ?? null;
  if (dp != null && remaining != null) {
    return `Belum cocok: transfer ${formatRpCompact(received)}, booking ${code} butuh DP ${formatRpCompact(dp)}/ sisa ${formatRpCompact(remaining)}`;
  }
  if (remaining != null) {
    return `Belum cocok: transfer ${formatRpCompact(received)}, booking ${code} butuh sisa ${formatRpCompact(remaining)}`;
  }
  return `Belum cocok: transfer ${formatRpCompact(received)}, booking ${code}`;
}

function withSummary(result: Omit<PaymentMatchResult, "summary">): PaymentMatchResult {
  const full: PaymentMatchResult = { ...result, summary: "" };
  full.summary = formatPaymentProofSummary(full);
  return full;
}

function noteText(ocr: PaymentProofOcrInput, note?: string | null): string {
  return [note, ocr.raw_text].filter((part) => typeof part === "string" && part.trim()).join("\n");
}

/**
 * Cocokkan satu hasil OCR ke kandidat yang sudah disaring (terbuka, ada sisa, checkout masih berlaku).
 * Tidak menyentuh database.
 */
export function matchProofToCandidates(
  ocr: PaymentProofOcrInput | null | undefined,
  candidates: PaymentMatchCandidate[],
  options?: { now?: Date; note?: string | null },
): PaymentMatchResult {
  const source = ocr ?? {};
  const now = options?.now ?? new Date();
  const destination_ok = paymentDestinationOk(source);
  const received = receivedTransferAmount(source);
  const note = noteText(source, options?.note);
  const open = candidates.filter((candidate) => isOpenPaymentCandidate(candidate, now));

  if (open.length === 0) {
    return withSummary({
      status: "no_pending_booking",
      booking_code: null,
      booking_amount: null,
      expected_amount: null,
      amount_diff: null,
      match_reason: "Tidak ada booking terbuka dengan sisa tagihan.",
      destination_ok,
      received_amount: received,
      dp_amount: null,
      remaining_amount: null,
      transfer_fee_surplus: null,
    });
  }

  if (received == null) {
    const reference = referenceCandidate(open, note);
    return withSummary({
      status: "unmatched",
      booking_code: reference.bookingCode,
      booking_amount: positiveRupiah(reference.total),
      expected_amount: null,
      amount_diff: null,
      match_reason: `Nominal tidak terbaca. Booking terdekat ${reference.bookingCode} tidak diubah.`,
      destination_ok,
      received_amount: null,
      dp_amount: dpAmount(reference),
      remaining_amount: remainingBalance(reference),
      transfer_fee_surplus: null,
    });
  }

  const fits = open
    .map((candidate, index) => bestFitForBooking(candidate, received, note, index))
    .filter((fit): fit is BookingFit => fit != null);

  if (fits.length > 0) {
    fits.sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      if (left.feeOnly !== right.feeOnly) return left.feeOnly ? 1 : -1;
      if (left.room !== right.room) return left.room ? -1 : 1;
      if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
      return left.index - right.index;
    });
    const winner = fits[0];
    const status = statusFor(winner.expectation.kind, winner.candidate);
    const roomNote = winner.room ? " Catatan transfer menyebut tipe kamar." : "";
    const surplus = winner.diff > 0 ? winner.diff : null;
    const exactNote = winner.exact
      ? "persis"
      : winner.feeOnly
        ? "dalam toleransi biaya transfer"
        : "dalam toleransi";
    const surplusNote = surplus != null ? ` (${transferFeeSurplusNote(surplus)})` : "";
    const label =
      status === "matched_dp" ? "DP 50%" : status === "matched_remaining" ? "sisa tagihan" : "pelunasan";
    return withSummary({
      status,
      booking_code: winner.candidate.bookingCode,
      booking_amount: positiveRupiah(winner.candidate.total),
      expected_amount: winner.expectation.amount,
      amount_diff: winner.diff,
      match_reason:
        `Nominal ${formatRpCompact(received)} ${exactNote} ${label} ${winner.candidate.bookingCode} ` +
        `(${formatRpCompact(winner.expectation.amount)})${surplusNote}.${roomNote} Status pembayaran tidak diubah.`,
      destination_ok,
      received_amount: received,
      dp_amount: dpAmount(winner.candidate),
      remaining_amount: remainingBalance(winner.candidate),
      transfer_fee_surplus: surplus,
    });
  }

  const reference = referenceCandidate(open, note);
  const closest = closestExpectation(reference, received);
  const status = classifyMiss(reference, received);
  const reason =
    status === "partial"
      ? `Nominal ${formatRpCompact(received)} di bawah tagihan ${reference.bookingCode}.`
      : status === "overpaid"
        ? `Nominal ${formatRpCompact(received)} melebihi tagihan ${reference.bookingCode}.`
        : `Nominal ${formatRpCompact(received)} tidak dekat dengan DP, sisa, atau total ${reference.bookingCode}.`;
  return withSummary({
    status,
    booking_code: reference.bookingCode,
    booking_amount: positiveRupiah(reference.total),
    expected_amount: closest?.amount ?? null,
    amount_diff: closest ? received - closest.amount : null,
    match_reason: `${reason} Status pembayaran tidak diubah.`,
    destination_ok,
    received_amount: received,
    dp_amount: dpAmount(reference),
    remaining_amount: remainingBalance(reference),
    transfer_fee_surplus: null,
  });
}

function dpAmount(candidate: PaymentMatchCandidate): number | null {
  const nights = stayNights(candidate);
  const total = positiveRupiah(candidate.total);
  if (nights == null || nights < 2 || total == null) return null;
  return Math.round(total / 2);
}

export function collectRoomNames(row: Record<string, unknown> | null | undefined): string[] {
  const names: string[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) names.push(trimmed);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.name === "string") names.push(record.name);
      if (record.room_types) push(record.room_types);
    }
  };
  if (!row) return [];
  push(row.room_types);
  push(row.booking_rooms);
  if (typeof row.room_type === "string") push(row.room_type);
  return [...new Set(names)];
}

export function candidateFromBookingRow(row: Record<string, unknown>): PaymentMatchCandidate {
  return {
    bookingCode: String(row.reference_code ?? row.booking_code ?? "").trim(),
    total: Number(row.total_amount ?? row.quoted_total ?? 0),
    paid: money(row.paid_amount) ?? 0,
    nights: money(row.nights),
    checkIn: typeof row.check_in === "string" ? row.check_in : null,
    checkOut: typeof row.check_out === "string" ? row.check_out : null,
    status: typeof row.status === "string" ? row.status : null,
    paymentStatus: typeof row.payment_status === "string" ? row.payment_status : null,
    roomTypes: collectRoomNames(row),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    source: "booking",
  };
}

export function candidateFromDraftRow(row: Record<string, unknown>): PaymentMatchCandidate {
  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  const roomFromPayload =
    (typeof payload.room_type === "string" && payload.room_type) ||
    (typeof payload.roomType === "string" && payload.roomType) ||
    null;
  const code = String(row.booking_code ?? "").trim();
  const id = String(row.id ?? "").replace(/-/g, "").slice(0, 4);
  return {
    bookingCode: code || (id ? `DRAFT-${id}` : "DRAFT"),
    total: Number(row.quoted_total ?? payload.quoted_total ?? payload.total ?? 0),
    paid: 0,
    nights: nightsBetween(
      typeof row.check_in === "string" ? row.check_in : null,
      typeof row.check_out === "string" ? row.check_out : null,
    ),
    checkIn: typeof row.check_in === "string" ? row.check_in : null,
    checkOut: typeof row.check_out === "string" ? row.check_out : null,
    status: typeof row.status === "string" ? row.status : "draft",
    paymentStatus: "unpaid",
    roomTypes: collectRoomNames({ ...row, room_type: row.room_type ?? roomFromPayload }),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    source: "draft",
  };
}
