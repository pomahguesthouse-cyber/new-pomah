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

export function bookingSummaryLead(completeAndValid: boolean): string {
  return completeAndValid
    ? "Data pemesanan sudah lengkap! Berikut ringkasannya:\n\n"
    : "Berikut ringkasan data pemesanan:\n\n";
}
