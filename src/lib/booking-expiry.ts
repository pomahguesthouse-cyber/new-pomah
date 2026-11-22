import { isOnsitePaymentMethod } from "@/lib/deposit-policy";

/**
 * Batas waktu pembayaran booking transfer: 1 jam sejak booking dibuat.
 * Booking bayar di tempat menyimpan expires_at null dan tidak pernah
 * masuk cron `expire-bookings`.
 */

const PAYMENT_DEADLINE_MS = 60 * 60 * 1000;

export function computeBookingExpiryIso(now = Date.now()): string {
  return new Date(now + PAYMENT_DEADLINE_MS).toISOString();
}

/**
 * Cron expire hanya boleh menutup booking transfer yang belum bayar
 * dan sudah lewat expires_at. Bayar di tempat (termasuk payment_method
 * "Bayar di tempat saat check-in") dan expires_at kosong dilewati.
 */
export function shouldExpireUnpaidBooking(
  row: {
    status?: string | null;
    payment_status?: string | null;
    payment_method?: string | null;
    expires_at?: string | null;
  },
  now = Date.now(),
): boolean {
  if (String(row.status ?? "") !== "pending") return false;
  if (String(row.payment_status ?? "") !== "unpaid") return false;
  if (isOnsitePaymentMethod(row.payment_method)) return false;
  if (!row.expires_at) return false;
  const deadline = Date.parse(row.expires_at);
  if (!Number.isFinite(deadline)) return false;
  return deadline < now;
}
