import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capAvailabilityWithStopSell, stopSellNights } from "../src/services/pricing/stop-sell-availability";

const ov = new Map([
  ["2026-10-16", { date: "2026-10-16", stop_sell: true }],
  ["2026-10-19", { date: "2026-10-19", stop_sell: true }],
  ["2026-10-20", { date: "2026-10-20", stop_sell: false }],
]);

// Stop-sell night inside the stay closes the room type.
assert.deepEqual(capAvailabilityWithStopSell(1, "2026-10-16", "2026-10-17", ov), { available: 0, stop_sell_dates: ["2026-10-16"] });
assert.deepEqual(capAvailabilityWithStopSell(3, "2026-10-15", "2026-10-21", ov).stop_sell_dates, ["2026-10-16", "2026-10-19"]);
// Check-out is exclusive: leaving on the stop-sell date is fine.
assert.deepEqual(capAvailabilityWithStopSell(2, "2026-10-17", "2026-10-19", ov), { available: 2, stop_sell_dates: [] });
// stop_sell=false rows and missing overrides do not block.
assert.equal(capAvailabilityWithStopSell(2, "2026-10-20", "2026-10-21", ov).available, 2);
assert.equal(capAvailabilityWithStopSell(2, "2026-10-16", "2026-10-17", undefined).available, 2);
// Already-capped RPC (new migration) stays 0; garbage is clamped.
assert.equal(capAvailabilityWithStopSell(0, "2026-10-16", "2026-10-17", ov).available, 0);
assert.equal(capAvailabilityWithStopSell(-1, "2026-10-17", "2026-10-18", ov).available, 0);
assert.equal(capAvailabilityWithStopSell(Number.NaN, "2026-10-17", "2026-10-18", ov).available, 0);
assert.deepEqual(stopSellNights("2026-10-17", "2026-10-17", ov), []);

// Website + bot wiring.
const pub = readFileSync("src/public/functions/public.functions.ts", "utf8");
assert.match(pub, /capAvailabilityWithStopSell\(/);
assert.match(pub, /stopSellDates,\n\s*debug/);
const bm = readFileSync("src/ai/state-machine/booking-machine.ts", "utf8");
assert.equal((bm.match(/rpc\("room_type_availability_detail"/g) ?? []).length, 1, "booking-machine must use loadRoomAvailability only");
assert.match(bm, /capAvailabilityWithStopSell\(current/);

// Migration keeps signature and implements per-night max + stop-sell.
const sql = readFileSync("supabase/migrations/20261016120000_room_type_availability_per_night_stop_sell.sql", "utf8");
assert.match(sql, /room_type_availability_detail\(p_check_in date, p_check_out date\)\s*returns table\(room_type_id uuid, total integer, taken integer, available integer\)/);
assert.match(sql, /generate_series\(p_check_in, p_check_out - 1/);
assert.match(sql, /max\(booked\)/);
assert.match(sql, /stop_sell is true/);
assert.match(sql, /d\.date < p_check_out/);

console.log("stop-sell availability tests passed");
