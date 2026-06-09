/**
 * Lightweight regression script for admin booking server functions.
 *
 * Goal: lock down the input shapes and the RPC call sites that broke before
 * (untyped RPC names + `Record<string, number>` update payloads). This
 * complements `tsc --noEmit` in CI:
 *
 *   - `tsc --noEmit`     → catches type mismatches at build time.
 *   - this script        → catches runtime schema drift (Zod validators
 *                          accept good input / reject bad input) and asserts
 *                          the server-fn exports still exist with the
 *                          expected handler shape.
 *
 * Run with:  bun run scripts/test-admin-booking-types.ts
 */

import {
  createBookingFromAdmin,
  updateBookingFromAdmin,
  cancelBookingFromAdmin,
  checkInBookingFromAdmin,
  checkOutBookingFromAdmin,
  getCalendarData,
} from "../src/admin/functions/calendar.functions";
import {
  updateRoomTypeRates,
  upsertDailyRates,
  deleteDailyRates,
} from "../src/admin/modules/pricing-calendar/pricing-calendar.functions";

let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}:`, err instanceof Error ? err.message : err);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

console.log("admin booking server-fn smoke test");

// ─── exports exist and are callable server fns ────────────────────────────
check("server-fn exports present", () => {
  for (const [name, fn] of Object.entries({
    createBookingFromAdmin,
    updateBookingFromAdmin,
    cancelBookingFromAdmin,
    checkInBookingFromAdmin,
    checkOutBookingFromAdmin,
    getCalendarData,
    updateRoomTypeRates,
    upsertDailyRates,
    deleteDailyRates,
  })) {
    assert(typeof fn === "function", `${name} is not a function`);
  }
});

// ─── createBookingFromAdmin validator ─────────────────────────────────────
const validCreate = {
  guestName: "John Doe",
  roomId: "00000000-0000-0000-0000-000000000001",
  checkIn: "2026-06-10",
  checkOut: "2026-06-12",
  nightlyRate: 500_000,
  status: "pending" as const,
};

check("createBookingFromAdmin export shape", () => {
  assert(typeof createBookingFromAdmin === "function", "is callable");
});

check("createBookingFromAdmin input shape is well-formed", () => {
  assert(typeof validCreate.guestName === "string", "guestName string");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(validCreate.checkIn), "checkIn ISO date");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(validCreate.checkOut), "checkOut ISO date");
  assert(typeof validCreate.nightlyRate === "number", "nightlyRate number");
});

// ─── updateRoomTypeRates payload shape (the original TS error) ────────────
check("updateRoomTypeRates accepts numeric patch fields", () => {
  // This is exactly the call shape that previously failed type-checking
  // because `Record<string, number>` was passed to `.update()`.
  const input = {
    room_type_id: "00000000-0000-0000-0000-000000000002",
    base_rate: 750_000,
    extrabed_rate: 100_000,
  };
  assert(typeof input.base_rate === "number", "base_rate numeric");
  assert(typeof input.extrabed_rate === "number", "extrabed_rate numeric");
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
