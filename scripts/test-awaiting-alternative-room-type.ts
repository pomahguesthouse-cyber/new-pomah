/**
 * Regression tests for AWAITING_ALTERNATIVE_ROOM_TYPE state.
 *
 * Run: bun run scripts/test-awaiting-alternative-room-type.ts
 *
 * Covers the 6 acceptance cases from the spec:
 *   1. Requested room unavailable → stage = AWAITING_ALTERNATIVE_ROOM_TYPE.
 *   2. "ya" while awaiting → no booking, alternatives shown again.
 *   3. Name while awaiting → guestName saved, stage unchanged.
 *   4. Email while awaiting → guestEmail saved, stage unchanged.
 *   5. Valid alternative chosen → selectedRoomType saved, flow continues.
 *   6. No `create_booking` is invoked until selectedRoomType + guest info ready.
 */

import {
  processBookingState,
  type BookingState,
  type BookingContext,
  type StateRecord,
  type AlternativeRoomOption,
} from "../src/ai/state-machine/booking-machine";
import { offerAlternativeRooms } from "../src/tools/offer-alternative-rooms.tool";
import type { ToolContext } from "../src/tools/types";

// ─── Tiny test harness ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function eq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✅ ${label}`); }
  else    { failed++; console.error(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`); }
}
function truthy(label: string, v: unknown) {
  if (v) { passed++; console.log(`  ✅ ${label}`); }
  else   { failed++; console.error(`  ❌ ${label} (got: ${JSON.stringify(v)})`); }
}

// ─── Fake supabase: just tracks state writes ────────────────────────────────
type RpcCall = { name: string; params: Record<string, unknown> };
function makeFakeSupabase(initial: { state: BookingState; context: BookingContext }) {
  const calls: RpcCall[] = [];
  let current = { state: initial.state, context: { ...initial.context } };
  return {
    calls,
    getState: () => current,
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "update_booking_state") {
        current = {
          state: params.p_state as BookingState,
          context: { ...(params.p_context as BookingContext) },
        };
      }
      return { data: null, error: null };
    },
  };
}

const ROOMS = [
  { id: "rt-deluxe",   name: "Deluxe",        base_rate: 250000 } as any,
  { id: "rt-grand",    name: "Grand Deluxe",  base_rate: 300000 } as any,
  { id: "rt-family",   name: "Family Room 222", base_rate: 400000 } as any,
  { id: "rt-suite",    name: "Family Suite 100", base_rate: 500000 } as any,
];

function makeCtx(supabase: ReturnType<typeof makeFakeSupabase>): ToolContext {
  return {
    supabasePublic: supabase as any,
    supabaseAdmin:  supabase as any,
    rooms: ROOMS,
    property: { name: "Pomah" } as any,
    today: "2026-06-09",
    phone: "6281234567899",
  } as ToolContext;
}

function makeRecord(state: BookingState, context: BookingContext): StateRecord {
  return { phone: "6281234567899", state, context, updated_at: new Date().toISOString(), slots: {} };
}

const ALTS: AlternativeRoomOption[] = [
  { roomTypeId: "rt-grand",  name: "Grand Deluxe",     pricePerNight: 300000 },
  { roomTypeId: "rt-family", name: "Family Room 222",  pricePerNight: 400000 },
  { roomTypeId: "rt-suite",  name: "Family Suite 100", pricePerNight: 500000 },
];

function freshBaseCtx(): BookingContext {
  return {
    checkIn:  "2026-06-10",
    checkOut: "2026-06-12",
    adults:   2,
    children: 0,
    requestedRoomType:     "Deluxe",
    availableAlternatives: ALTS.map((a) => ({ ...a })),
  };
}

// ─── Test 1: offer_alternative_rooms tool sets the stage ─────────────────────
console.log("\nTest 1: requested room unavailable → AWAITING_ALTERNATIVE_ROOM_TYPE");
{
  const sb = makeFakeSupabase({ state: "IDLE", context: {} });
  const ctx = makeCtx(sb);
  const raw = await offerAlternativeRooms({
    requested_room_type: "Deluxe",
    check_in:  "2026-06-10",
    check_out: "2026-06-12",
    adults: 2, children: 0,
    alternatives: [
      { room_type: "Grand Deluxe",     price_per_night: 300000 },
      { room_type: "Family Room 222",  price_per_night: 400000 },
      { room_type: "Family Suite 100", price_per_night: 500000 },
    ],
  }, ctx);
  const parsed = JSON.parse(raw);
  eq("tool ok",                     parsed.ok,            true);
  eq("relay_verbatim",              parsed.relay_verbatim, true);
  truthy("message contains Deluxe penuh", /Deluxe.*penuh/i.test(parsed.message));
  truthy("message lists Grand Deluxe", parsed.message.includes("Grand Deluxe"));
  const s = sb.getState();
  eq("state transition",            s.state, "AWAITING_ALTERNATIVE_ROOM_TYPE");
  eq("requestedRoomType saved",     s.context.requestedRoomType, "Deluxe");
  eq("alternatives saved (3)",      s.context.availableAlternatives?.length, 3);
  eq("dates kept",                  s.context.checkIn, "2026-06-10");
}

// ─── Test 2: "ya" → no booking, alternatives shown again ─────────────────────
console.log("\nTest 2: \"ya\" while awaiting → reshow alternatives, no booking");
{
  const sb = makeFakeSupabase({ state: "AWAITING_ALTERNATIVE_ROOM_TYPE", context: { ...baseCtx } });
  const ctx = makeCtx(sb);
  const res = await processBookingState(ctx, "6281234567899", "ya", makeRecord("AWAITING_ALTERNATIVE_ROOM_TYPE", baseCtx));
  eq("handled",                     res.handled, true);
  truthy("reply lists Grand Deluxe", res.reply?.includes("Grand Deluxe"));
  truthy("reply mentions Deluxe penuh", /Deluxe.*penuh/i.test(res.reply ?? ""));
  const noBookingInsert = !sb.calls.some((c) => c.name === "create_booking" || (typeof c.params.p_state === "string" && c.params.p_state === "PAYMENT_PENDING"));
  truthy("no booking insert / payment transition", noBookingInsert);
}

// ─── Test 3: name → guestName saved, stage unchanged ─────────────────────────
console.log("\nTest 3: name while awaiting → guestName saved, stage unchanged");
{
  const sb = makeFakeSupabase({ state: "AWAITING_ALTERNATIVE_ROOM_TYPE", context: { ...baseCtx } });
  const ctx = makeCtx(sb);
  const res = await processBookingState(ctx, "6281234567899", "Budi Santoso", makeRecord("AWAITING_ALTERNATIVE_ROOM_TYPE", baseCtx));
  eq("handled",                     res.handled, true);
  const s = sb.getState();
  eq("stage unchanged",             s.state, "AWAITING_ALTERNATIVE_ROOM_TYPE");
  eq("guestName saved",             s.context.guestName, "Budi Santoso");
  truthy("reply asks for room type", /Grand Deluxe|tipe kamar/i.test(res.reply ?? ""));
  truthy("reply greets Budi",        res.reply?.includes("Budi"));
}

// ─── Test 4: email → guestEmail saved, stage unchanged ───────────────────────
console.log("\nTest 4: email while awaiting → guestEmail saved, stage unchanged");
{
  const sb = makeFakeSupabase({ state: "AWAITING_ALTERNATIVE_ROOM_TYPE", context: { ...baseCtx } });
  const ctx = makeCtx(sb);
  const res = await processBookingState(ctx, "6281234567899", "budi.test@example.com", makeRecord("AWAITING_ALTERNATIVE_ROOM_TYPE", baseCtx));
  eq("handled",                     res.handled, true);
  const s = sb.getState();
  eq("stage unchanged",             s.state, "AWAITING_ALTERNATIVE_ROOM_TYPE");
  eq("guestEmail saved",            s.context.guestEmail, "budi.test@example.com");
  truthy("reply confirms email",     res.reply?.includes("budi.test@example.com"));
  truthy("reply asks for room type", /Grand Deluxe|Family/i.test(res.reply ?? ""));
}

// ─── Test 5: valid alternative → selectedRoomType saved, flow advances ───────
console.log("\nTest 5: valid alternative chosen → selectedRoomType saved, flow advances");
{
  const sb = makeFakeSupabase({ state: "AWAITING_ALTERNATIVE_ROOM_TYPE", context: { ...baseCtx } });
  const ctx = makeCtx(sb);
  const res = await processBookingState(ctx, "6281234567899", "Grand Deluxe", makeRecord("AWAITING_ALTERNATIVE_ROOM_TYPE", baseCtx));
  eq("handled",                     res.handled, true);
  const s = sb.getState();
  eq("stage advanced to AWAITING_NAME", s.state, "AWAITING_NAME");
  eq("selectedRoomType saved",      s.context.selectedRoomType, "Grand Deluxe");
  eq("roomName saved",              s.context.roomName, "Grand Deluxe");
  eq("rooms[0] qty",                s.context.rooms?.[0]?.quantity, 1);
  truthy("reply confirms Grand Deluxe & asks for nama", /Grand Deluxe/i.test(res.reply ?? "") && /nama/i.test(res.reply ?? ""));
}

// ─── Test 6: no create_booking before selectedRoomType + slots complete ─────
console.log("\nTest 6: no create_booking before selectedRoomType + slots complete");
{
  // Simulate the full sequence: "ya" → name → email; none should create a booking.
  const sb = makeFakeSupabase({ state: "AWAITING_ALTERNATIVE_ROOM_TYPE", context: { ...baseCtx } });
  const ctx = makeCtx(sb);
  for (const msg of ["ya", "Budi Santoso", "budi.test@example.com"]) {
    const cur = sb.getState();
    await processBookingState(ctx, "6281234567899", msg, makeRecord(cur.state, cur.context));
  }
  const s = sb.getState();
  eq("still in AWAITING_ALTERNATIVE_ROOM_TYPE", s.state, "AWAITING_ALTERNATIVE_ROOM_TYPE");
  const everTransitionedToBooking = sb.calls.some(
    (c) => c.name === "update_booking_state" &&
           ["PAYMENT_PENDING", "CONFIRMING_BOOKING"].includes(c.params.p_state as string),
  );
  truthy("never transitioned to CONFIRMING_BOOKING/PAYMENT_PENDING", !everTransitionedToBooking);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
