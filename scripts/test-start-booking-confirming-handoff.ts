/**
 * Regression test for booking handoff after the guest selects an alternative
 * room. When all required slots are already present, start_booking_details must
 * move the conversation to CONFIRMING_BOOKING and show the final review, not a
 * generic "mohon konfirmasi" prompt that can loop on the next "ya".
 *
 * Run: npx tsx scripts/test-start-booking-confirming-handoff.ts
 */

import { startBookingDetails } from "../src/tools/start-booking.tool";
import type { BookingContext } from "../src/ai/state-machine/booking-machine";
import type { ToolContext } from "../src/tools/types";

let passed = 0;
let failed = 0;

function truthy(label: string, value: unknown): void {
  if (value) {
    passed += 1;
    console.log(`PASS ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label} (got: ${JSON.stringify(value)})`);
}

function eq<T>(label: string, actual: T, expected: T): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`PASS ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

function makeFakeSupabase() {
  const calls: any[] = [];
  const db: any = {
    calls,
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ type: "rpc", name, params });
      return { data: null, error: null };
    },
    from: (table: string) => {
      calls.push({ type: "from", table });
      let data: any = [];
      if (table === "rooms") data = [{ id: "rm-deluxe", number: "201", room_type_id: "rt-deluxe" }];
      if (table === "guests") data = { id: "gt-test" };

      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        ilike: () => chain,
        not: () => chain,
        lt: () => chain,
        gt: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
        insert: (payload: any) => {
          calls.push({ type: "insert", table, payload });
          return chain;
        },
        then: (resolve: any) => resolve({ data, error: null }),
      };
      return chain;
    },
  };
  return db;
}

function makeCtx(supabase: ReturnType<typeof makeFakeSupabase>): ToolContext {
  return {
    supabasePublic: supabase as never,
    supabaseAdmin: supabase as never,
    rooms: [
      { id: "rt-single", name: "Single", base_rate: 200000 },
      { id: "rt-deluxe", name: "Deluxe", base_rate: 250000 },
      { id: "rt-grand", name: "Grand Deluxe", base_rate: 300000 },
    ] as never,
    property: { id: "prop-test", name: "Pomah Guesthouse" } as never,
    today: "2026-07-06",
    phone: "6285641364101",
  } as ToolContext;
}

function latestBookingStateCall(sb: ReturnType<typeof makeFakeSupabase>) {
  return [...sb.calls].reverse().find((call) => call.name === "update_booking_state");
}

console.log("\nTest 1: complete alternative-room handoff enters final confirmation");
{
  const sb = makeFakeSupabase();
  const ctx = makeCtx(sb);

  const raw = await startBookingDetails(
    {
      check_in: "2026-07-07",
      check_out: "2026-07-09",
      adults: 1,
      room_type: "Deluxe",
      price_per_night: 250000,
      guest_name: "Faizal",
    },
    ctx,
  );
  const result = JSON.parse(raw);
  const updateCall = latestBookingStateCall(sb);
  const context = updateCall?.params?.p_context as BookingContext | undefined;

  eq("tool result ok", result.ok, true);
  eq("state is CONFIRMING_BOOKING", updateCall?.params?.p_state, "CONFIRMING_BOOKING");
  eq("room is Deluxe", context?.roomName, "Deluxe");
  eq("guest name preserved", context?.guestName, "Faizal");
  eq("adult count preserved", context?.adults, 1);
  eq("dynamic price preserved", context?.pricePerNight, 250000);
  eq("total price calculated", context?.totalPrice, 500000);
  truthy("reply shows final review", /Apakah data di atas sudah benar/i.test(result.message ?? ""));
  truthy("reply asks booking/payment confirmation", /Booking & Pembayaran/i.test(result.message ?? ""));
  truthy(
    "reply does not use old looping prompt",
    !/Mohon konfirmasi untuk melanjutkan pemesanan/i.test(result.message ?? ""),
  );
}

console.log("\nTest 2: missing adult count still asks for guest count");
{
  const sb = makeFakeSupabase();
  const ctx = makeCtx(sb);

  const raw = await startBookingDetails(
    {
      check_in: "2026-07-07",
      check_out: "2026-07-09",
      room_type: "Deluxe",
      price_per_night: 250000,
      guest_name: "Faizal",
    },
    ctx,
  );
  const result = JSON.parse(raw);
  const updateCall = latestBookingStateCall(sb);

  eq("tool result ok", result.ok, true);
  eq("state remains COLLECTING_DATA", updateCall?.params?.p_state, "COLLECTING_DATA");
  truthy("reply asks for guest count", /jumlah tamu/i.test(result.message ?? ""));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
