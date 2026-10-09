/**
 * Hari ini filter: Asia/Jakarta calendar date, and the PostgREST clauses
 * that select check-in / check-out / in-house rows across every page.
 */
import assert from "node:assert/strict";
import {
  applyDayClauses,
  buildDayClauses,
  dayFilterHeaderDate,
  dayFilterScopeLabel,
  dayWindow,
  matchesDayFilter,
  parseBookingDayChip,
  wibCalendarDate,
  type BookingDayChip,
  type DayClause,
  type DayQueryBuilder,
  type DayWindow,
} from "../src/admin/lib/booking-day-filter";

function wibInstant(date: string, hm: string): Date {
  return new Date(`${date}T${hm}:00+07:00`);
}

const at0030 = wibInstant("2026-10-09", "00:30");
const at2330 = wibInstant("2026-10-09", "23:30");

assert.equal(at0030.toISOString(), "2026-10-08T17:30:00.000Z");
assert.equal(at2330.toISOString(), "2026-10-09T16:30:00.000Z");
assert.equal(wibCalendarDate(at0030), "2026-10-09");
assert.equal(wibCalendarDate(at2330), "2026-10-09");
assert.equal(new Date(at0030).toISOString().slice(0, 10), "2026-10-08", "UTC date is the previous day at 00:30 WIB");

const window0030 = dayWindow(at0030);
const window2330 = dayWindow(at2330);
assert.deepEqual(window0030, { today: "2026-10-09", tomorrow: "2026-10-10" });
assert.deepEqual(window2330, { today: "2026-10-09", tomorrow: "2026-10-10" });

const justAfterMidnight = dayWindow(wibInstant("2026-10-10", "00:30"));
assert.deepEqual(justAfterMidnight, { today: "2026-10-10", tomorrow: "2026-10-11" });

const todayWindow = window2330;

assert.equal(parseBookingDayChip(undefined), "all");
assert.equal(parseBookingDayChip("nope"), "all");
assert.equal(parseBookingDayChip("checkin"), "checkin");

assert.deepEqual(buildDayClauses("all", todayWindow, "all"), []);
assert.deepEqual(buildDayClauses("checkin", todayWindow, "all"), [
  { op: "eq", column: "check_in", value: "2026-10-09" },
  { op: "neq", column: "status", value: "cancelled" },
]);
assert.deepEqual(buildDayClauses("checkout", todayWindow, "confirmed"), [
  { op: "eq", column: "check_out", value: "2026-10-09" },
  { op: "neq", column: "status", value: "cancelled" },
]);
assert.deepEqual(buildDayClauses("stay", todayWindow, "all"), [
  { op: "lte", column: "check_in", value: "2026-10-09" },
  { op: "gt", column: "check_out", value: "2026-10-09" },
  { op: "neq", column: "status", value: "cancelled" },
]);
assert.deepEqual(buildDayClauses("tomorrow", todayWindow, "all"), [
  { op: "eq", column: "check_in", value: "2026-10-10" },
  { op: "neq", column: "status", value: "cancelled" },
]);
assert.deepEqual(buildDayClauses("today", todayWindow, "all"), [
  {
    op: "or",
    filter:
      "check_in.eq.2026-10-09,check_out.eq.2026-10-09,and(check_in.lte.2026-10-09,check_out.gt.2026-10-09)",
  },
  { op: "neq", column: "status", value: "cancelled" },
]);
assert.deepEqual(buildDayClauses("checkin", todayWindow, "cancelled"), [
  { op: "eq", column: "check_in", value: "2026-10-09" },
]);
assert.deepEqual(buildDayClauses("checkin", justAfterMidnight, "all")[0], {
  op: "eq",
  column: "check_in",
  value: "2026-10-10",
});

type Call = { op: string; column?: string; value?: string; filter?: string };

function recordingQuery(): DayQueryBuilder & { calls: Call[] } {
  const calls: Call[] = [];
  const query: DayQueryBuilder & { calls: Call[] } = {
    calls,
    eq(column, value) {
      calls.push({ op: "eq", column, value });
      return query;
    },
    lte(column, value) {
      calls.push({ op: "lte", column, value });
      return query;
    },
    gt(column, value) {
      calls.push({ op: "gt", column, value });
      return query;
    },
    neq(column, value) {
      calls.push({ op: "neq", column, value });
      return query;
    },
    or(filter) {
      calls.push({ op: "or", filter });
      return query;
    },
  };
  return query;
}

const recorded = recordingQuery();
applyDayClauses(recorded, buildDayClauses("today", todayWindow, "all"));
assert.deepEqual(recorded.calls, [
  {
    op: "or",
    filter:
      "check_in.eq.2026-10-09,check_out.eq.2026-10-09,and(check_in.lte.2026-10-09,check_out.gt.2026-10-09)",
  },
  { op: "neq", column: "status", value: "cancelled" },
]);

function clauseMatches(row: { check_in: string; check_out: string; status: string }, clause: DayClause): boolean {
  if (clause.op === "eq") return row[clause.column] === clause.value;
  if (clause.op === "lte") return row.check_in <= clause.value;
  if (clause.op === "gt") return row.check_out > clause.value;
  if (clause.op === "neq") return row.status !== clause.value;
  const day = clause.filter.slice("check_in.eq.".length, "check_in.eq.".length + 10);
  const checkIn = row.check_in === day;
  const checkOut = row.check_out === day;
  const inHouse = row.check_in <= day && row.check_out > day;
  return checkIn || checkOut || inHouse;
}

function queryMatches(
  row: { check_in: string; check_out: string; status: string },
  clauses: readonly DayClause[],
): boolean {
  return clauses.every((clause) => clauseMatches(row, clause));
}

const rows = [
  { name: "arrives today, leaves later", check_in: "2026-10-09", check_out: "2026-10-11", status: "confirmed" },
  { name: "leaves today", check_in: "2026-10-07", check_out: "2026-10-09", status: "checked_in" },
  { name: "in house tonight", check_in: "2026-10-08", check_out: "2026-10-12", status: "checked_in" },
  { name: "same-day turn", check_in: "2026-10-09", check_out: "2026-10-09", status: "confirmed" },
  { name: "arrives tomorrow", check_in: "2026-10-10", check_out: "2026-10-12", status: "pending" },
  { name: "already left", check_in: "2026-10-01", check_out: "2026-10-03", status: "checked_out" },
  { name: "cancelled arrival", check_in: "2026-10-09", check_out: "2026-10-11", status: "cancelled" },
  { name: "cancelled but asked for", check_in: "2026-10-09", check_out: "2026-10-10", status: "cancelled" },
];

const expected: Record<string, Record<BookingDayChip, boolean>> = {
  "arrives today, leaves later": { all: true, today: true, checkin: true, checkout: false, stay: true, tomorrow: false },
  "leaves today": { all: true, today: true, checkin: false, checkout: true, stay: false, tomorrow: false },
  "in house tonight": { all: true, today: true, checkin: false, checkout: false, stay: true, tomorrow: false },
  "same-day turn": { all: true, today: true, checkin: true, checkout: true, stay: false, tomorrow: false },
  "arrives tomorrow": { all: true, today: false, checkin: false, checkout: false, stay: false, tomorrow: true },
  "already left": { all: true, today: false, checkin: false, checkout: false, stay: false, tomorrow: false },
  "cancelled arrival": { all: true, today: false, checkin: false, checkout: false, stay: false, tomorrow: false },
  "cancelled but asked for": { all: true, today: true, checkin: true, checkout: false, stay: true, tomorrow: false },
};

for (const row of rows) {
  const statusFilter = row.name === "cancelled but asked for" ? "cancelled" : "all";
  for (const chip of ["all", "today", "checkin", "checkout", "stay", "tomorrow"] as const) {
    const want = expected[row.name][chip];
    const clauses = buildDayClauses(chip, todayWindow, statusFilter);
    assert.equal(matchesDayFilter(row, chip, todayWindow, statusFilter), want, `${row.name} / ${chip} matcher`);
    assert.equal(queryMatches(row, clauses), want, `${row.name} / ${chip} query`);
  }
}

assert.equal(matchesDayFilter(rows[6], "checkin", todayWindow, "cancelled"), true);

const bothEnds: DayWindow[] = [window0030, window2330];
for (const window of bothEnds) {
  assert.equal(dayFilterHeaderDate("checkin", window), "2026-10-09");
  assert.equal(dayFilterHeaderDate("tomorrow", window), "2026-10-10");
  assert.equal(buildDayClauses("today", window, "all")[0].op === "or" && (buildDayClauses("today", window, "all")[0] as { filter: string }).filter.includes("2026-10-09"), true);
}

assert.equal(dayFilterScopeLabel("checkin"), "Hari ini (Check-in)");
assert.equal(dayFilterScopeLabel("stay"), "Hari ini (Menginap)");
assert.equal(dayFilterScopeLabel("tomorrow"), "Besok");

console.log("booking day filter tests passed");
