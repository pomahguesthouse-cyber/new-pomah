/**
 * Quick date chips on the admin booking list.
 *
 * "Today" is the Asia/Jakarta calendar date (WIB, UTC+7, no daylight saving),
 * not the UTC date and not the device timezone. A booking is relevant today
 * when check-in is today, check-out is today, or the guest is in-house tonight
 * (check_in <= today < check_out).
 */
import { nextDay } from "@/lib/date";

export const BOOKING_DAY_PARAMS = ["today", "checkin", "checkout", "stay", "tomorrow"] as const;

export type BookingDayParam = (typeof BOOKING_DAY_PARAMS)[number];

/** `all` is the default list and is left out of the URL. */
export type BookingDayChip = "all" | BookingDayParam;

export type DayWindow = {
  today: string;
  tomorrow: string;
};

export type DayClause =
  | { op: "eq"; column: "check_in" | "check_out"; value: string }
  | { op: "lte"; column: "check_in"; value: string }
  | { op: "gt"; column: "check_out"; value: string }
  | { op: "neq"; column: "status"; value: "cancelled" }
  | { op: "or"; filter: string };

export type DayQueryBuilder = {
  eq(column: string, value: string): DayQueryBuilder;
  lte(column: string, value: string): DayQueryBuilder;
  gt(column: string, value: string): DayQueryBuilder;
  neq(column: string, value: string): DayQueryBuilder;
  or(filters: string): DayQueryBuilder;
};

export function parseBookingDayChip(value: unknown): BookingDayChip {
  if (typeof value === "string" && (BOOKING_DAY_PARAMS as readonly string[]).includes(value)) {
    return value as BookingDayParam;
  }
  return "all";
}

/** YYYY-MM-DD for an absolute instant in Asia/Jakarta. */
export function wibCalendarDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function dayWindow(now: Date = new Date()): DayWindow {
  const today = wibCalendarDate(now);
  return { today, tomorrow: nextDay(today) };
}

export function isTodayFamily(chip: BookingDayChip): boolean {
  return chip === "today" || chip === "checkin" || chip === "checkout" || chip === "stay";
}

/**
 * Clauses are AND-ed onto the existing status, source, and search filters.
 * "Hari ini" is a single OR group so check-in, check-out, and in-house stays
 * are all included. Cancelled bookings are dropped unless the status filter
 * explicitly asks for them.
 */
export function buildDayClauses(chip: BookingDayChip, window: DayWindow, status?: string | null): DayClause[] {
  if (chip === "all") return [];
  const clauses: DayClause[] = [];
  const day = window.today;
  if (chip === "today") {
    clauses.push({
      op: "or",
      filter: `check_in.eq.${day},check_out.eq.${day},and(check_in.lte.${day},check_out.gt.${day})`,
    });
  } else if (chip === "checkin") {
    clauses.push({ op: "eq", column: "check_in", value: day });
  } else if (chip === "checkout") {
    clauses.push({ op: "eq", column: "check_out", value: day });
  } else if (chip === "stay") {
    clauses.push({ op: "lte", column: "check_in", value: day });
    clauses.push({ op: "gt", column: "check_out", value: day });
  } else {
    clauses.push({ op: "eq", column: "check_in", value: window.tomorrow });
  }
  if (status !== "cancelled") clauses.push({ op: "neq", column: "status", value: "cancelled" });
  return clauses;
}

export function applyDayClauses<Q>(query: Q, clauses: readonly DayClause[]): Q {
  let next = query as DayQueryBuilder;
  for (const clause of clauses) {
    if (clause.op === "or") next = next.or(clause.filter);
    else if (clause.op === "eq") next = next.eq(clause.column, clause.value);
    else if (clause.op === "lte") next = next.lte(clause.column, clause.value);
    else if (clause.op === "gt") next = next.gt(clause.column, clause.value);
    else next = next.neq(clause.column, clause.value);
  }
  return next as Q;
}

/**
 * Same rules as {@link buildDayClauses}, without PostgREST. Status equality
 * (confirmed, pending, …) stays on the existing status filter; this only
 * applies the day window and the default cancelled exclusion.
 */
export function matchesDayFilter(
  row: { check_in: string; check_out: string; status: string },
  chip: BookingDayChip,
  window: DayWindow,
  statusFilter?: string | null,
): boolean {
  if (chip !== "all" && statusFilter !== "cancelled" && row.status === "cancelled") return false;
  if (chip === "all") return true;
  if (chip === "checkin") return row.check_in === window.today;
  if (chip === "checkout") return row.check_out === window.today;
  if (chip === "tomorrow") return row.check_in === window.tomorrow;
  if (chip === "stay") return row.check_in <= window.today && row.check_out > window.today;
  return (
    row.check_in === window.today ||
    row.check_out === window.today ||
    (row.check_in <= window.today && row.check_out > window.today)
  );
}

/** Label inside the PDF header, without the leading "Filter:" or the date. */
export function dayFilterScopeLabel(chip: BookingDayChip): string {
  switch (chip) {
    case "today":
      return "Hari ini";
    case "checkin":
      return "Hari ini (Check-in)";
    case "checkout":
      return "Hari ini (Check-out)";
    case "stay":
      return "Hari ini (Menginap)";
    case "tomorrow":
      return "Besok";
    default:
      return "";
  }
}

/** Calendar date printed next to the chip. Besok uses tomorrow; the rest use today. */
export function dayFilterHeaderDate(chip: BookingDayChip, window: DayWindow): string {
  return chip === "tomorrow" ? window.tomorrow : window.today;
}
