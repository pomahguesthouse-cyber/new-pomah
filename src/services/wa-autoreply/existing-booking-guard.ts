/**
 * Tamu yang SUDAH punya booking aktif tidak boleh ditawari cek ketersediaan.
 *
 * Insiden SULO (PG-MBGMB, 17 Okt 2026 14:24): tamu yang sudah tiba bertanya
 * "check in nya di sebelah mana?" → dijawab jam check-in; lalu "saya sudah
 * pesan, kode PG-MBGMB" → dijawab daftar kamar kosong (fast path availability).
 */
import { mentionsExplicitDateSignal } from "@/lib/id-date";

const BOOKING_CODE_RE = /\bPG-[A-Z0-9]{4,6}\b/i;
const CLAIMS_BOOKED_RE =
  /\b(sudah|udah|udh|sdh|telah)\s+(pesan|pesen|booking|book|booked|reservasi|bayar|transfer|dp|check.?in|sampai|sampe|di depan|di lokasi)\b/i;
const ASKS_NEW_STAY_RE =
  /\b(kosong|tersedia|available|ready|tambah kamar|kamar lain|booking lagi|pesan lagi|pesan kamar lagi|extend|perpanjang|nambah malam|tambah malam)\b/i;

export function shouldSkipAvailabilityForExistingBooking(input: {
  message: string;
  hasActiveBooking: boolean;
}): boolean {
  const text = String(input.message ?? "");
  if (!text.trim()) return false;
  if (ASKS_NEW_STAY_RE.test(text)) return false;
  if (mentionsExplicitDateSignal(text)) return false;
  return input.hasActiveBooking || BOOKING_CODE_RE.test(text) || CLAIMS_BOOKED_RE.test(text);
}

