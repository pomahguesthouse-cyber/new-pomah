import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ *
 * Indonesian date formatting
 *
 * Use these everywhere a date is shown to a user so the whole app
 * speaks the same language. DATE-only strings from the database
 * ("YYYY-MM-DD") are parsed manually to avoid the timezone shift you
 * get from `new Date("2026-05-15")` (which is parsed as UTC midnight
 * and can roll back a day in negative-offset locales).
 * ------------------------------------------------------------------ */

const ID_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const ID_DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** Parse a value into a Date. Date-only strings are treated as local dates. */
function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // "YYYY-MM-DD" → construct as a local date (no timezone shift)
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "15/05/2026" */
export function formatDateID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** "15 Mei 2026" */
export function formatDateMediumID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Jumat, 15 Mei 2026" */
export function formatDateLongID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${ID_DAYS[d.getDay()]}, ${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14.30" — 24-hour, Indonesian dot separator */
export function formatTimeID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}.${mi}`;
}

/** "15/05/2026 14.30" */
export function formatDateTimeID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${formatDateID(d)} ${formatTimeID(d)}`;
}

/** "Hari ini" / "Kemarin" / "Jumat, 15 Mei 2026" */
export function formatRelativeDateID(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === yest.toDateString()) return "Kemarin";
  return formatDateLongID(d);
}
