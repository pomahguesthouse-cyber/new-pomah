/**
 * Public City Guide event-date rules (Asia/Jakarta).
 *
 * Recurring labels such as "Tiap Hari" stay visible. Dated events whose
 * end date is already before today WIB are hidden. Unparseable labels are
 * kept so future / fuzzy events are not dropped by accident.
 */

import { todayWIB } from "./date";
import { ID_MONTHS, makeIsoDate } from "./id-date";

const RECURRING_RE =
  /\b(tiap|setiap)\s+(hari|minggu|bulan|akhir\s*pekan|weekend|senin|selasa|rabu|kamis|jum'?at|jumat|sabtu)\b/i;

const MONTH_NAMES = Object.keys(ID_MONTHS)
  .filter((name) => name.length >= 3)
  .sort((a, b) => b.length - a.length);

const MONTH_RE = MONTH_NAMES.join("|");

export function isRecurringExploreDate(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return RECURRING_RE.test(raw);
}

/**
 * Last calendar day an event covers, as YYYY-MM-DD, or null if unknown.
 * Understands DD/MM/YYYY, "15 Agustus 2026", "10-12 September 2026",
 * and "Sepanjang Oktober 2026".
 */
export function parseExploreEventEndIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const slashMatches = [...text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)];
  if (slashMatches.length > 0) {
    const last = slashMatches[slashMatches.length - 1];
    return makeIsoDate(Number(last[1]), Number(last[2]), Number(last[3]));
  }

  const lower = text.toLowerCase();
  const years = lower.match(/20\d{2}/g);
  const year = years ? Number(years[years.length - 1]) : null;
  if (!year) return null;

  const range = lower.match(new RegExp(`(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(${MONTH_RE})`, "i"));
  if (range) {
    const month = ID_MONTHS[range[3].toLowerCase()];
    if (month) return makeIsoDate(Number(range[2]), month, year);
  }

  const dayMonths = [...lower.matchAll(new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})`, "gi"))];
  if (dayMonths.length > 0) {
    const last = dayMonths[dayMonths.length - 1];
    const month = ID_MONTHS[last[2].toLowerCase()];
    if (month) return makeIsoDate(Number(last[1]), month, year);
  }

  const months = [...lower.matchAll(new RegExp(`(${MONTH_RE})`, "gi"))];
  if (months.length > 0) {
    const month = ID_MONTHS[months[months.length - 1][1].toLowerCase()];
    if (month) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return makeIsoDate(lastDay, month, year);
    }
  }

  return null;
}

/** True when the event should appear on the public /explore page. */
export function isPublicExploreEventVisible(
  date: string | null | undefined,
  todayWib: string = todayWIB(),
): boolean {
  if (isRecurringExploreDate(date)) return true;
  const endIso = parseExploreEventEndIso(date);
  if (!endIso) return true;
  return endIso >= todayWib;
}

export function filterPublicExploreEvents<T extends { date?: string | null }>(
  events: T[] | null | undefined,
  todayWib: string = todayWIB(),
): T[] {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => isPublicExploreEventVisible(event?.date, todayWib));
}

/** Strip past dated events from a stored explore_config JSON object. */
export function stripPastEventsFromExploreConfig<T>(
  exploreConfig: T,
  todayWib: string = todayWIB(),
): T {
  if (!exploreConfig || typeof exploreConfig !== "object" || Array.isArray(exploreConfig)) {
    return exploreConfig;
  }
  const cfg = exploreConfig as T & { events?: Array<{ date?: string | null }> };
  if (!Array.isArray(cfg.events)) return exploreConfig;
  return {
    ...cfg,
    events: filterPublicExploreEvents(cfg.events, todayWib),
  };
}
