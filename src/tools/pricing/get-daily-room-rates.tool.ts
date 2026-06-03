/**
 * Tool: get_daily_room_rates (managerial only)
 *
 * Read daily-rate overrides untuk rentang tanggal. Manajer biasanya
 * menyebut "lihat harga harian Juni" / "harga Deluxe minggu depan".
 *
 *  • room_type opsional — kalau diisi, filter ke satu tipe; kalau kosong,
 *    return semua tipe (mode "scan bulanan").
 *  • from_date / to_date wajib YYYY-MM-DD. to_date opsional, default
 *    = from_date (single date).
 *  • include_base_rate (default true): merge ke output tanggal yang TIDAK
 *    punya override, dengan source="base_rate". Memudahkan agen me-rangkum
 *    "yang di-override vs yang masih base".
 *
 * Output JSON murni (atas permintaan): array per (room_type_id, date).
 * Tidak ada formatting Telegram — biar LLM yang rangkum.
 *
 * Guard: ctx.isManager === true.
 */

import { isDateString, nextDay } from "@/lib/date";
import { getDailyRatesForRange } from "@/services/pricing/daily-rate.service";
import type { ToolContext, ToolHandler } from "@/tools/types";
import { resolveRoomType } from "./_resolve-room-type";

const MAX_RANGE_DAYS = 366;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function boolDefault(v: unknown, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|ya|1)$/i.test(v))  return true;
    if (/^(false|no|tidak|0)$/i.test(v)) return false;
  }
  return def;
}

export const getDailyRoomRates: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Tool ini hanya tersedia untuk manajer/super admin.",
    });
  }

  const fromDate    = str(args.from_date);
  const toDateRaw   = str(args.to_date);
  const roomNeedle  = str(args.room_type);
  const includeBase = boolDefault(args.include_base_rate, true);

  if (!fromDate || !isDateString(fromDate)) {
    return JSON.stringify({ ok: false, error: "Sebutkan `from_date` (YYYY-MM-DD)." });
  }
  const toDate = toDateRaw && isDateString(toDateRaw) ? toDateRaw : fromDate;
  if (toDate < fromDate) {
    return JSON.stringify({
      ok: false,
      error: `to_date (${toDate}) tidak boleh sebelum from_date (${fromDate}).`,
    });
  }

  // Filter to a single room type if requested.
  const rooms = (() => {
    if (!roomNeedle) return ctx.rooms;
    const r = resolveRoomType(roomNeedle, ctx.rooms);
    return r.ok ? [r.room] : null;
  })();
  if (rooms == null) {
    const r = resolveRoomType(roomNeedle!, ctx.rooms);
    return JSON.stringify({ ok: false, error: r.ok ? "" : r.error });
  }

  // CheckOut-exclusive convention in the service; "lihat harga Juni 1–30"
  // means we want INCLUSIVE 30 too, so pass toDate+1 as the exclusive end.
  const exclusiveEnd = nextDay(toDate);

  // Sanity cap.
  let days = 0; { let d = fromDate; while (d < exclusiveEnd) { days++; d = nextDay(d); } }
  if (days > MAX_RANGE_DAYS) {
    return JSON.stringify({
      ok: false,
      error: `Rentang ${days} hari melebihi batas ${MAX_RANGE_DAYS} hari.`,
    });
  }

  const roomIds = rooms.map((r) => r.id);
  const overridesByRoom = await getDailyRatesForRange(
    ctx.supabasePublic,
    roomIds,
    fromDate,
    exclusiveEnd,
  );

  interface OutRow {
    date:          string;
    room_type_id:  string;
    room_name:     string;
    rate:          number;
    extrabed_rate: number | null;   // null = fallback to room_types.extrabed_rate
    stop_sell:     boolean;
    min_stay:      number;
    note:          string | null;
    source:        "daily_rate" | "base_rate";
  }
  const out: OutRow[] = [];
  for (const room of rooms) {
    const baseRate     = Number(room.base_rate     ?? 0);
    const baseExtraBed = Number(room.extrabed_rate ?? 0);
    const byDate = overridesByRoom.get(room.id);

    let d = fromDate;
    while (d < exclusiveEnd) {
      const ov = byDate?.get(d);
      if (ov) {
        out.push({
          date:          d,
          room_type_id:  room.id,
          room_name:     room.name,
          rate:          Number(ov.rate),
          extrabed_rate: ov.extrabed_rate == null ? null : Number(ov.extrabed_rate),
          stop_sell:     ov.stop_sell,
          min_stay:      ov.min_stay,
          note:          ov.note,
          source:        "daily_rate",
        });
      } else if (includeBase) {
        out.push({
          date:          d,
          room_type_id:  room.id,
          room_name:     room.name,
          rate:          baseRate,
          extrabed_rate: baseExtraBed,
          stop_sell:     false,
          min_stay:      1,
          note:          null,
          source:        "base_rate",
        });
      }
      d = nextDay(d);
    }
  }

  return JSON.stringify({
    ok: true,
    from_date:     fromDate,
    to_date:       toDate,
    room_filter:   roomNeedle ?? null,
    include_base_rate: includeBase,
    count:         out.length,
    rates:         out,
  });
};
