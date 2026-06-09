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

const ID_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2, pebruari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

/**
 * Best-effort coerce a date input from the LLM into YYYY-MM-DD.
 * Handles:
 *  - already-correct "YYYY-MM-DD"
 *  - "8 juni 2026", "08 Jun 2026", "8/6/2026", "8-6-2026", "2026/06/08"
 * Returns null if it can't make sense of the value.
 */
function coerceDate(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const s: string = v.trim().toLowerCase();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY/MM/DD
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "8 juni 2026" / "8 jun"
  m = s.match(/^(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?$/);
  if (m) {
    const [, d, monthName, yRaw] = m;
    const mo = ID_MONTHS[monthName];
    if (mo) {
      const year = yRaw
        ? (yRaw.length === 2 ? `20${yRaw}` : yRaw)
        : today.slice(0, 4);
      return `${year}-${String(mo).padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return null;
}

export const checkRoomAvailability: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const today = (ctx as { today?: string }).today ?? new Date().toISOString().slice(0, 10);
  const coercedIn  = coerceDate(args.check_in, today);
  const coercedOut = coerceDate(args.check_out, today);

  if (!coercedIn) {
    // Tamu belum menyebut tanggal — jangan tandai sebagai error (LLM bisa
    // salah tafsir jadi "sistem gangguan"). Beri pesan siap-kirim ke tamu.
    return JSON.stringify({
      ok: true,
      need_dates: true,
      reply_to_guest:
        "Boleh tahu untuk tanggal berapa Kakak rencana menginap, dan sampai tanggal berapa ya? 📅",
      instruction_to_agent:
        "Tanggal belum diketahui. Kirim `reply_to_guest` VERBATIM ke tamu. " +
        "JANGAN bilang sistem error/gangguan. Setelah tamu menjawab tanggal, panggil ulang tool ini.",
    });
  }

  const checkIn  = coercedIn;
  let   checkOut = coercedOut ?? nextDay(checkIn);
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
