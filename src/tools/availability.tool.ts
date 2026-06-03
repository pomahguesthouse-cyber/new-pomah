/**
 * Tool: check_room_availability
 *
 * Queries real-time room availability from the database AND resolves
 * the dynamic nightly rate via `daily-rate.service`. Returns a structured
 * JSON payload the LLM formats into a human-readable reply.
 *
 * Rate semantics (per night):
 *   • If `room_daily_rates` has a row for (room_type_id, date) → pakai.
 *   • Else → fallback ke `room_types.base_rate`.
 *
 * Stop-sell semantics:
 *   • Any night with `stop_sell=true` di rentang menginap → tipe kamar itu
 *     ditandai `tidak_tersedia: true` + alasan netral untuk tamu. Output
 *     juga menyertakan `stop_sell_dates` (machine-readable) agar Front
 *     Office Agent / state machine bisa menolak lanjut.
 *
 * Output JSON tetap **additive** — field lama (harga_per_malam, kamar_tersedia,
 * dst.) dipertahankan agar prompt agen yang sudah ada tetap bekerja.
 */

import { isDateString, nextDay, fmtDateID } from "@/lib/date";
import {
  getDailyRatesForRange,
  resolveRoomNightlyRates,
} from "@/services/pricing/daily-rate.service";
import type { ToolContext, ToolHandler } from "./types";

interface AvailabilityRow {
  room_type_id: string;
  total:        number;
  taken:        number;
  available:    number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRpc = (name: string, params: Record<string, unknown>) => Promise<{ data: unknown }>;

export const checkRoomAvailability: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (!isDateString(args.check_in)) {
    // Jangan fallback ke "hari ini" jika tamu belum pernah menyebut tanggal.
    // Minta agen mengonfirmasi tanggal lebih dulu agar booking tidak salah tanggal.
    return JSON.stringify({
      ok: false,
      need_dates: true,
      error:
        "Tanggal check-in belum diketahui. Tanyakan dulu kepada tamu: " +
        "'Untuk tanggal berapa Kak rencana menginap, dan sampai tanggal berapa?' " +
        "Jangan asumsikan hari ini. Setelah tamu menjawab, panggil ulang tool ini dengan tanggal yang benar.",
    });
  }

  const checkIn  = args.check_in as string;
  let   checkOut = isDateString(args.check_out) ? (args.check_out as string) : nextDay(checkIn);
  if (checkOut <= checkIn) checkOut = nextDay(checkIn);

  // Catat tanggal yang dipakai supaya orchestrator bisa menyimpannya ke slots
  // — turn berikutnya tidak akan kehilangan konteks tanggal.
  ctx.lastDates = { checkIn, checkOut };

  // RPC return shape pre-dates strict types; cast once at the boundary.
  const rpc = (ctx.supabasePublic as unknown as { rpc: AnyRpc }).rpc;
  const { data: rows } = await rpc("room_type_availability_detail", {
    p_check_in:  checkIn,
    p_check_out: checkOut,
  });

  const byId = new Map<string, AvailabilityRow>(
    ((rows ?? []) as AvailabilityRow[]).map((r) => [r.room_type_id, r]),
  );

  // Resolve dynamic nightly rates for ALL room types in one round-trip.
  const roomTypeIds = ctx.rooms.map((r) => r.id);
  const overridesByRoom = await getDailyRatesForRange(
    ctx.supabasePublic,
    roomTypeIds,
    checkIn,
    checkOut,
  );

  const nights = (() => {
    // Cheap nights count without a second pass through listNights.
    let n = 0;
    let cur = checkIn;
    while (cur < checkOut) { n++; cur = nextDay(cur); }
    return n;
  })();

  const kamar = ctx.rooms.map((r) => {
    const d       = byId.get(r.id);
    const resolved = resolveRoomNightlyRates(
      r,
      checkIn,
      checkOut,
      overridesByRoom.get(r.id),
    );

    const blockedByStopSell = resolved.has_stop_sell;
    const baseAvailable     = d ? d.available : null;
    const availableEffective = blockedByStopSell ? 0 : baseAvailable;

    // Breakdown only when rates differ per night — keeps payloads compact
    // for the common "all base rate" case.
    const uniqueRates = new Set(resolved.nightly.map((n) => n.rate));
    const nightlyBreakdown = uniqueRates.size > 1
      ? resolved.nightly.map((n) => ({
          tanggal: n.date,
          harga:   n.rate,
          sumber:  n.source,
        }))
      : undefined;

    return {
      room_type_id:    r.id,
      nama:            r.name,
      // Per-malam harga: nightly_rate (rate untuk malam pertama). Field
      // lama `harga_per_malam` dipertahankan untuk backward compatibility
      // — sekarang merefleksikan rate aktual malam pertama, bukan base_rate
      // statis. Ini lebih tepat untuk kebutuhan tamu menanyakan harga.
      harga_per_malam: resolved.nightly[0]?.rate ?? Number(r.base_rate ?? 0),
      nightly_rate:    resolved.nightly[0]?.rate ?? Number(r.base_rate ?? 0),
      total_rate:      resolved.total,
      malam:           nights,
      nightly_breakdown: nightlyBreakdown,
      kamar_tersedia:  availableEffective,
      total_kamar:     d ? d.total : null,
      tidak_tersedia:  blockedByStopSell || (baseAvailable !== null && baseAvailable <= 0),
      stop_sell_dates: blockedByStopSell ? resolved.stop_sell_dates : undefined,
      alasan: blockedByStopSell
        ? `Kamar ini tidak dijual untuk tanggal ${resolved.stop_sell_dates.map(fmtDateID).join(", ")}.`
        : (d ? undefined : "jumlah kamar belum diatur di sistem"),
      catatan: d ? undefined : "jumlah kamar belum diatur di sistem",
    };
  });

  return JSON.stringify({
    check_in:  checkIn,
    check_out: checkOut,
    nights,
    tanggal:   fmtDateID(checkIn),
    periode:   `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`,
    kamar,
  });
};
