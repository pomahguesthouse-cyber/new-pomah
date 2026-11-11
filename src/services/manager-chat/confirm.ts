/**
 * Konfirmasi tulis manajer harus eksplisit: YA / KONFIRMASI.
 * "ok tanggalnya 22 Juni" atau "iya, jumlah tamu 5" BUKAN konfirmasi.
 */

import {
  isBookingConfirmationMessage,
  isBookingNegationOrCorrection,
} from "@/ai/state-machine/booking-machine";

const EXPLICIT_CONFIRM_RE =
  /^(?:ya|iya|yes)\s*(?:[,.]?\s*konfirmasi)?[\s.!,]*$|^konfirmasi[\s.!,]*$|^ya\s*,?\s*konfirmasi[\s.!,]*$/i;

export function isExplicitManagerConfirmation(message: string): boolean {
  const text = String(message ?? "").trim();
  if (!text || text.includes("?")) return false;
  if (isBookingNegationOrCorrection(text)) return false;
  if (EXPLICIT_CONFIRM_RE.test(text)) return true;
  // Terima "ya kak" / "iya lanjut" yang sudah lolos saringan murni,
  // TAPI tetap menolak "ok" polos — tugas meminta YA/KONFIRMASI.
  if (/^\s*ok+\s*$/i.test(text) || /^\s*oke+\s*$/i.test(text)) return false;
  return isBookingConfirmationMessage(text) && /\b(ya|iya|yes|konfirmasi)\b/i.test(text);
}

export function isManagerCancelMessage(message: string): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return /^(batal|cancel|tidak|tdk|gak|nggak|jangan|nope|no)([\s.!,]+)?$/i.test(text);
}

export function isManagerHelpMessage(message: string): boolean {
  const text = String(message ?? "").trim().toLowerCase();
  return /^(bantuan|help|menu|perintah|cmd|\?|\/help|\/bantuan)$/i.test(text);
}

export type ManagerModeSwitch = "guest" | "manager";

export function parseManagerModeSwitch(message: string): ManagerModeSwitch | null {
  const text = String(message ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^\/?(mode\s+)?tamu$/.test(text) || text === "/tamu" || text === "jadi tamu") return "guest";
  if (
    /^\/?(mode\s+)?(manajer|manager|admin)$/.test(text) ||
    text === "/manajer" ||
    text === "/manager" ||
    text === "jadi manajer"
  ) {
    return "manager";
  }
  return null;
}

export function isNextPageMessage(message: string): boolean {
  const text = String(message ?? "").trim().toLowerCase();
  return /^(lagi|selanjutnya|berikutnya|next|lebih banyak|halaman (berikutnya|selanjutnya))$/i.test(text);
}
