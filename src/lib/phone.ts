/**
 * Phone-number helpers shared across the WhatsApp/booking flow.
 *
 * Indonesian numbers are stored inconsistently across the DB (guests, threads)
 * — sometimes "081...", sometimes "6281...", "+6281...", or digits-only. When
 * we need to match a guest by the number they're chatting from, we compare
 * against the full set of plausible stored representations.
 */

/** Build the set of plausible stored representations of a phone number. */
export function phoneVariants(raw: string | null | undefined): string[] {
  const set = new Set<string>();
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  set.add(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  if (digits) {
    set.add(digits);
    if (digits.startsWith("0")) set.add("62" + digits.slice(1));
    if (digits.startsWith("62")) set.add("0" + digits.slice(2));
    set.add("+" + digits);
  }
  return Array.from(set);
}

/**
 * Normalize an Indonesian phone number to digits-only with a 62 prefix.
 * Identitas panjang (LID WhatsApp, ≥15 digit) tidak diubah menjadi nomor 62.
 *
 * Modul murni (tanpa import server) — dipakai pencocokan WA inbound
 * (identity.ts) dan halaman admin Daftar Manager supaya aturannya sama.
 */
export function normalizePhone(raw: string): string {
  let phone = String(raw ?? "").replace(/\D/g, "");
  if (phone.length >= 15) return phone;
  if (phone.startsWith("620")) phone = `62${phone.slice(3)}`;
  else if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith("8")) phone = `62${phone}`;
  return phone;
}
