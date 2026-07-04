/**
 * Regression test: prefill guestName dari chat_summary_json.guest_name.
 *
 * Tamu yang sudah pernah menyebut nama (tersimpan di context summary) tidak
 * boleh ditanya nama lagi saat booking. Nilai janggal dari LLM summarizer
 * harus ditolak validator looksLikePersonName.
 *
 * Run: npx tsx scripts/test-guest-name-prefill.ts
 */

import {
  processBookingState,
  type BookingState,
  type BookingContext,
} from "../src/ai/state-machine/booking-machine";
import type { ToolContext } from "../src/tools/types";

let passed = 0;
let failed = 0;
function truthy(label: string, v: unknown) {
  if (v) { passed++; console.log(`  ✅ ${label}`); }
  else   { failed++; console.error(`  ❌ ${label} (got: ${JSON.stringify(v)})`); }
}

function makeFakeSupabase(initial: { state: BookingState; context: BookingContext }) {
  let current = { state: initial.state, context: { ...initial.context } };
  return {
    getState: () => current,
    rpc: async (name: string, params: Record<string, unknown>) => {
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

const ROOMS = [{ id: "rt-deluxe", name: "Deluxe", base_rate: 250000 } as any];

function makeCtx(supabase: ReturnType<typeof makeFakeSupabase>): ToolContext {
  return {
    supabasePublic: supabase as any,
    supabaseAdmin: supabase as any,
    rooms: ROOMS,
    property: { name: "Pomah Guesthouse" } as any,
    today: "2026-07-03",
    origin: "https://pomahguesthouse.com",
    phone: "6281234567890",
  } as ToolContext;
}

const BASE_CONTEXT: BookingContext = {
  roomName: "Deluxe",
  checkIn: "2026-07-10",
  checkOut: "2026-07-11",
  pricePerNight: 250000,
} as BookingContext;

// Catatan: pesan default sengaja TANPA jumlah tamu — sejak kebijakan
// auto-book (4 Jul 2026), slot lengkap langsung memicu createBooking yang
// butuh DB sungguhan; harness ini hanya menguji pengisian slot nama.
async function run(knownGuestName: string | null, message = "🙏") {
  const supabase = makeFakeSupabase({ state: "COLLECTING_DATA", context: { ...BASE_CONTEXT } });
  const result = await processBookingState(
    makeCtx(supabase),
    "6281234567890",
    message,
    { state: "COLLECTING_DATA", context: { ...BASE_CONTEXT } },
    { knownGuestName },
  );
  return { result, finalContext: supabase.getState().context };
}

console.log("Test 1: nama dari summary dipakai — tidak tanya nama lagi");
{
  const { result, finalContext } = await run("Lutfi Jihan Priyanti");
  truthy("handled", result.handled);
  truthy("guestName terisi dari summary", finalContext.guestName === "Lutfi Jihan Priyanti");
  truthy("reply TIDAK meminta nama", !/nama lengkap/i.test(result.reply ?? ""));
  truthy("reply meminta jumlah tamu (slot wajib baru)", /jumlah tamu/i.test(result.reply ?? ""));
}

console.log("Test 2: tanpa nama tersimpan — tetap minta nama (regresi)");
{
  const { result, finalContext } = await run(null);
  truthy("handled", result.handled);
  truthy("guestName kosong", !finalContext.guestName);
  truthy("reply meminta nama", /nama lengkap/i.test(result.reply ?? ""));
}

console.log("Test 3: nilai janggal dari summarizer ditolak");
{
  const { result, finalContext } = await run("mau tanya kamar dulu");
  truthy("guestName tetap kosong", !finalContext.guestName);
  truthy("reply meminta nama", /nama lengkap/i.test(result.reply ?? ""));
}

console.log("Test 4: nama eksplisit di pesan menang atas summary");
{
  const { finalContext } = await run("Lutfi Jihan Priyanti", "atas nama Budi Santoso");
  truthy("guestName = Budi Santoso (bukan dari summary)", finalContext.guestName === "Budi Santoso");
}

console.log("Test 5: koreksi data + konfirmasi \"Ya\" (regresi bug regex \\\\b)");
{
  // Turn 1: tamu minta ganti nama → bot menyimpan pendingOverride & minta konfirmasi.
  const supabase = makeFakeSupabase({
    state: "COLLECTING_DATA",
    context: { ...BASE_CONTEXT, guestName: "Budi Santoso" },
  });
  const ask = await processBookingState(
    makeCtx(supabase),
    "6281234567890",
    "atas nama Lutfi Jihan",
    { state: "COLLECTING_DATA", context: { ...BASE_CONTEXT, guestName: "Budi Santoso" } },
    {},
  );
  truthy("turn 1: bot minta konfirmasi ganti", /diganti|Balas "Ya"/i.test(ask.reply ?? ""));
  truthy("turn 1: pendingOverride tersimpan", !!supabase.getState().context.pendingOverride);

  // Turn 2: tamu balas "Ya" → override HARUS diterapkan.
  // Sebelum fix, regex /\\b(ya|...)\\b/ tidak pernah cocok sehingga koreksi dibuang.
  const confirm = await processBookingState(
    makeCtx(supabase),
    "6281234567890",
    "Ya",
    { state: supabase.getState().state, context: { ...supabase.getState().context } },
    {},
  );
  truthy("turn 2: handled", confirm.handled);
  truthy(
    "turn 2: nama terganti ke Lutfi Jihan",
    supabase.getState().context.guestName === "Lutfi Jihan",
  );
  truthy(
    "turn 2: TIDAK ada balasan 'tetap gunakan data sebelumnya'",
    !/tetap gunakan data/i.test(confirm.reply ?? ""),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
