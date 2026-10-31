/**
 * Owner payment policy (16 Oct 2026): "untuk pemesanan 2 malam ke bawah harus lunas".
 *
 *   • Transfer, 1–2 nights → paid in full before arrival, no 50% DP option.
 *   • Transfer, 3+ nights  → DP 50% (or pay in full).
 *   • Bayar di tempat (pay at check-in) is allowed for ALL guests again
 *     (owner decision 31 Oct 2026). Such bookings carry payment_method='onsite',
 *     have no payment deadline (expires_at null) and are never auto-expired.
 *
 * Every place that decides or communicates the deposit must use these helpers.
 */

/** Stays of this many nights or fewer must be paid in full. */
export const FULL_PAYMENT_MAX_NIGHTS = 2;
/** DP share for stays that allow a deposit (unchanged). */
export const DEPOSIT_RATIO = 0.5;
export const DEPOSIT_PERCENT = Math.round(DEPOSIT_RATIO * 100);

/** Guest-facing policy sentence. */
export const FULL_PAYMENT_POLICY_TEXT = "pembayaran transfer untuk pemesanan 1–2 malam dibayar lunas";

function validNights(nights: number | null | undefined): number | null {
  const n = Number(nights);
  return nights != null && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** True for 1–2 night stays (unknown nights → false, caller decides wording). */
export function requiresFullPayment(nights: number | null | undefined): boolean {
  const n = validNights(nights);
  return n != null && n <= FULL_PAYMENT_MAX_NIGHTS;
}

/** True only for stays long enough to pay a DP (3+ nights). */
export function allowsDeposit(nights: number | null | undefined): boolean {
  const n = validNights(nights);
  return n != null && n > FULL_PAYMENT_MAX_NIGHTS;
}

/** Bayar di tempat diperbolehkan untuk semua tamu (keputusan pemilik 31 Okt 2026). */
export function allowsPayAtCheckin(_nights?: number | null): boolean {
  return true;
}

/** Nilai bookings.payment_method untuk bayar di tempat. */
export const ONSITE_PAYMENT_METHOD = "onsite";

/** Kalimat opsi bayar di tempat untuk tamu. */
export const PAY_AT_CHECKIN_TEXT = "bisa juga bayar di tempat saat check-in";

/** True bila payment_method menandai bayar di tempat (termasuk nilai lama). */
export function isOnsitePaymentMethod(method: string | null | undefined): boolean {
  const m = String(method ?? "").trim().toLowerCase();
  return m === "onsite" || m === "cash" || m === "pay_at_checkin" || m === "bayar_di_tempat";
}

/** Tamu memilih bayar di tempat ("bayar di tempat ya", "cash saat check-in"). */
export function mentionsPayAtCheckin(message: string): boolean {
  return /\b(bayar(?:nya)?\s+(?:di\s+tempat|di\s+lokasi|langsung\s+di\s+tempat|pas\s+(?:datang|check[\s-]?in|sampai)|saat\s+(?:datang|check[\s-]?in|tiba))|lunas\s+di\s+tempat|cash\s+(?:di\s+tempat|saat\s+check[\s-]?in|pas\s+datang)|cod)\b/i.test(
    message,
  );
}

/**
 * Minimum amount the guest must pay to secure the booking:
 * full total for 1–2 nights, DP 50% for 3+ nights. Unknown nights → DP rule
 * is not assumed; the full total is returned.
 */
export function requiredDepositAmount(nights: number | null | undefined, total: number): number {
  const t = Number.isFinite(Number(total)) ? Math.max(0, Math.round(Number(total))) : 0;
  return allowsDeposit(nights) ? Math.round(t * DEPOSIT_RATIO) : t;
}
