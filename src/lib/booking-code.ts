/**
 * Helper kode booking — satu tempat untuk memvalidasi dan mencocokkan
 * `bookings.reference_code`.
 *
 * Latar (audit 7 Agu 2026 — S1/S3): lookup kode booking tersebar di banyak
 * tempat dan semuanya memakai `.ilike("reference_code", <input>)`. Karena `%`
 * dan `_` adalah wildcard ILIKE, input seperti `"PG-%"` mencocokkan booking
 * milik tamu lain — cukup untuk membuat bot mengirim invoice, total tagihan,
 * atau nama pemesan orang lain kepada penanya. Tidak ada satu pun jalur yang
 * memverifikasi booking itu memang milik nomor yang sedang chat.
 *
 * Aturan sekarang:
 *   - Bentuk kode divalidasi lebih dulu (huruf/angka/strip, 3–20 karakter).
 *   - Pencocokan selalu persis (`.eq`) terhadap versi huruf besar.
 *   - Untuk tool yang bisa dipanggil dari kanal tamu, kepemilikan booking
 *     diverifikasi terhadap nomor penelepon.
 */

import { phoneVariants } from "@/lib/phone";

/** Bentuk kode booking yang diterima: "PG-9J6Y2" dan varian legacy. */
export const BOOKING_CODE_RE = /^[A-Za-z0-9-]{3,20}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalisasi kode booking ke huruf besar. Mengembalikan `null` bila bentuknya
 * tidak wajar (termasuk wildcard `%`/`_`, spasi, string kosong).
 */
export function normalizeBookingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !BOOKING_CODE_RE.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

/** True bila string berbentuk UUID booking. */
export function isBookingUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw.trim());
}

/** Pesan penolakan standar supaya nada balasan konsisten di semua tool. */
export function invalidBookingCodeError(raw: unknown): string {
  const shown = typeof raw === "string" ? raw.slice(0, 40) : String(raw);
  return `Format kode booking "${shown}" tidak valid. Kode booking berbentuk seperti PG-9J6Y2.`;
}

/**
 * Verifikasi booking dengan kode ini terdaftar atas nomor `phone`.
 *
 * Dipakai tool jalur tamu sebelum membuka detail booking. Manajer tidak perlu
 * lewat sini (mereka memang berwenang melihat semua booking).
 *
 * @returns `true` bila cocok; `false` bila tidak ditemukan / bukan milik nomor
 *          tersebut; `null` bila pengecekan gagal secara teknis (pemanggil
 *          sebaiknya menolak, bukan mengasumsikan boleh).
 */
export async function bookingBelongsToPhone(
  db: { from: (table: string) => any },
  bookingCode: string,
  phone: string | null | undefined,
): Promise<boolean | null> {
  const code = normalizeBookingCode(bookingCode);
  const variants = phoneVariants(phone);
  if (!code || variants.length === 0) return false;

  try {
    const { data, error } = await db
      .from("bookings")
      .select("id, guests!inner(phone)")
      .eq("reference_code", code)
      .in("guests.phone", variants)
      .limit(1);
    if (error) {
      console.warn("[booking-code] ownership check failed:", error.message ?? error);
      return null;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.warn("[booking-code] ownership check threw:", e);
    return null;
  }
}
