/**
 * Batas waktu pembayaran booking: 1 jam sejak booking dibuat, berlaku untuk
 * semua channel (web, chatbot WA, webchat, admin). Cron `expire-bookings`
 * yang menentukan apakah batas ini benar-benar ditegakkan (hanya untuk
 * payment_status='unpaid' — booking partial/lunas tidak pernah expire),
 * jadi nilai ini diset unconditional di setiap insert booking.
 */
const PAYMENT_DEADLINE_MS = 60 * 60 * 1000;

export function computeBookingExpiryIso(): string {
  return new Date(Date.now() + PAYMENT_DEADLINE_MS).toISOString();
}
