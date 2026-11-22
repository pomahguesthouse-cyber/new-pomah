/**
 * Teks ringkasan booking yang aman ditampilkan ke tamu.
 * Nama, email kosong, dan header kelengkapan tidak boleh menyesatkan.
 */

const EMPTY_PAREN_RE = /\(\s*(?:\+?\d[\d\s\-().]{5,})?\s*\)/g;

/** "Tri Handoyo ( )" dan "Tri Handoyo (0812…)" → "Tri Handoyo". Nomor tetap di baris HP. */
export function formatGuestNameForSummary(name?: string | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "—";
  const cleaned = raw
    .replace(EMPTY_PAREN_RE, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  return cleaned || "—";
}

/** Baris email. Kosong → tidak ditampilkan (bukan "(tidak diisi)"). */
export function formatEmailSummaryLine(email?: string | null): string {
  const value = (email ?? "").trim();
  if (!value) return "";
  return `• Email: ${value}\n`;
}

/** Label template bot. Nama yang masih memuat frasa ini bukan nama orang. */
const THREAD_TEMPLATE_NAME_RE =
  /\b(?:nama\s+lengkap(?:\s+tamu)?|nama\s+tamu|lengkap\s+tamu|data\s+booking\s+sementara|mohon\s+lengkapi(?:\s+data)?)\b/i;

/**
 * Nama yang boleh menggantikan `whatsapp_threads.display_name`.
 * Null bila kosong atau masih berisi kata template ("lengkap tamu HUSNI HARIS").
 */
export function guestNameSafeForThreadDisplay(name: string | null | undefined): string | null {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed || THREAD_TEMPLATE_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

export function bookingSummaryLead(completeAndValid: boolean): string {
  return completeAndValid
    ? "Data pemesanan sudah lengkap! Berikut ringkasannya:\n\n"
    : "Berikut ringkasan data pemesanan:\n\n";
}
