/**
 * Owner payment policy (16 Oct 2026): "untuk pemesanan 2 malam ke bawah harus lunas".
 *
 *   • 1–2 nights  → paid in full by transfer before arrival, no 50% DP option.
 *   • Pay-at-check-in (bayar di tempat) is disabled for new bookings (owner
 *     decision 16 Oct 2026). Existing bookings marked onsite keep displaying so.
 *   • 3+ nights  → existing rule: DP 50% (or pay in full).
 *
 * Every place that decides or communicates the deposit must use these helpers.
 */

/** Stays of this many nights or fewer must be paid in full. */
export const FULL_PAYMENT_MAX_NIGHTS = 2;
/** DP share for stays that allow a deposit (unchanged). */
export const DEPOSIT_RATIO = 0.5;
export const DEPOSIT_PERCENT = Math.round(DEPOSIT_RATIO * 100);

/** Guest-facing policy sentence. */
export const FULL_PAYMENT_POLICY_TEXT = "pemesanan 1–2 malam wajib lunas";

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

/** Pay-at-check-in is disabled for every new booking (owner decision 16 Oct 2026). */
export function allowsPayAtCheckin(_nights?: number | null): boolean {
  return false;
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
