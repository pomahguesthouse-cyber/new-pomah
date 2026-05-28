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

/** Current hour (0–23) at UTC+7 (WIB). */
export function hourWIB(): number {
  return new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
}

/** Current clock as "HH:MM" at UTC+7 (WIB). */
export function clockWIB(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Time-of-day Indonesian greeting based on the CURRENT WIB time — not on what
 * the guest typed. Pagi 04–10:59, Siang 11–14:59, Sore 15–17:59, Malam 18–03:59.
 */
export function greetingWIB(): string {
  const h = hourWIB();
  if (h >= 4 && h < 11) return "Selamat pagi";
  if (h >= 11 && h < 15) return "Selamat siang";
  if (h >= 15 && h < 18) return "Selamat sore";
  return "Selamat malam";
}
