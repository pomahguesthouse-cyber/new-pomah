/** Shared date utilities (timezone-aware for WIB = UTC+7). */

export const MONTHS_ID = [
  "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
] as const;

/** Format ISO date string to Indonesian display format: "19 Mei 2026" */
export function fmtDateID(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

/** Return the next calendar day as YYYY-MM-DD */
export function nextDay(d: string): string {
  return new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Today's date in YYYY-MM-DD format at UTC+7 */
export function todayWIB(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Validate that a value is a YYYY-MM-DD date string */
export function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
