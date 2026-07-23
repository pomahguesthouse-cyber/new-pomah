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
