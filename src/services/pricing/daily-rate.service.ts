/**
 * Daily-rate resolver.
 *
 * Source of truth for "what does one night cost?":
 *
 *   1. If `room_daily_rates` has a row for (room_type_id, date) → use it.
 *   2. Otherwise → fall back to `room_types.base_rate`.
 *
 * Same fallback applies to `extrabed_rate`. `stop_sell=true` means the
 * tipe kamar tidak dijual sama sekali untuk tanggal itu.
 *
 * Tanggal di-treat sebagai WIB-local (sama dengan `todayWIB`, `nextDay`,
 * `room_type_availability_detail` RPC, dan kolom `bookings.check_in`).
 * Tidak ada konversi timezone di sini — caller harus sudah pass YYYY-MM-DD.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomTypeRow } from "@/ai/context-builder";
import { nextDay } from "@/lib/date";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

/** Row shape stored in `public.room_daily_rates`. */
export interface DailyRateRow {
  room_type_id:  string;
  date:          string;          // YYYY-MM-DD
  rate:          number;
  extrabed_rate: number | null;
  min_stay:      number;
  stop_sell:     boolean;
  note:          string | null;
}

/** A single night in the resolved breakdown. */
export interface NightlyRate {
  date:          string;          // YYYY-MM-DD
  rate:          number;
  extrabed_rate: number;          // 0 if room type has no extrabed configured
  source:        "daily_rate" | "base_rate";
  stop_sell:     boolean;         // true only when override row says so
  min_stay:      number;          // 1 when no override
}

/** Per-room-type resolved nightly breakdown for a stay. */
export interface ResolvedStayRates {
  room_type_id:    string;
  check_in:        string;
  check_out:       string;        // exclusive
  nights:          number;
  nightly:         NightlyRate[];
  total:           number;        // sum of nightly.rate
  has_stop_sell:   boolean;       // any night blocks the stay
  stop_sell_dates: string[];      // nights with stop_sell=true (subset of [check_in, check_out))
  /** True bila semua malam pakai base_rate (tidak ada override sama sekali). */
  all_base:        boolean;
  /** Highest min_stay across the booked nights — informational, not enforced. */
  max_min_stay:    number;
}

/** Lazily generate the list of nightly dates in [check_in, check_out). */
export function listNights(checkIn: string, checkOut: string): string[] {
  if (checkOut <= checkIn) return [];
  const out: string[] = [];
  let cur = checkIn;
  while (cur < checkOut) {
    out.push(cur);
    cur = nextDay(cur);
  }
  return out;
}

/**
 * Fetch every daily-rate override for the given room types within
 * [checkIn, checkOut). CheckOut is exclusive (mirror booking semantics).
 *
 * Returns Map<room_type_id, Map<date, row>> so callers can do O(1) lookups.
 */
export async function getDailyRatesForRange(
  supabase:     AnyClient,
  roomTypeIds:  string[],
  checkIn:      string,
  checkOut:     string,
): Promise<Map<string, Map<string, DailyRateRow>>> {
  const out = new Map<string, Map<string, DailyRateRow>>();
  if (roomTypeIds.length === 0 || checkOut <= checkIn) return out;

  const { data, error } = await supabase
    .from("room_daily_rates")
    .select("room_type_id, date, rate, extrabed_rate, min_stay, stop_sell, note")
    .in("room_type_id", roomTypeIds)
    .gte("date", checkIn)
    .lt("date", checkOut);

  if (error) {
    console.error("[daily-rate.service] getDailyRatesForRange error:", error);
    return out;
  }

  for (const row of (data ?? []) as DailyRateRow[]) {
    let perRoom = out.get(row.room_type_id);
    if (!perRoom) {
      perRoom = new Map<string, DailyRateRow>();
      out.set(row.room_type_id, perRoom);
    }
    perRoom.set(row.date, row);
  }
  return out;
}

/**
 * Convenience: return a Set of stop-sell dates per room type.
 * Used by `check_room_availability` to mark blocked dates without
 * re-doing the lookup.
 */
export function buildStopSellMap(
  overrides: Map<string, Map<string, DailyRateRow>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [roomTypeId, byDate] of overrides) {
    const blocked = new Set<string>();
    for (const [date, row] of byDate) if (row.stop_sell) blocked.add(date);
    if (blocked.size > 0) out.set(roomTypeId, blocked);
  }
  return out;
}

/**
 * Resolve nightly rates for a single room type given a pre-fetched
 * overrides map (avoids per-call DB hit when the caller already
 * loaded a range). CheckOut exclusive.
 */
export function resolveRoomNightlyRates(
  roomType:  RoomTypeRow,
  checkIn:   string,
  checkOut:  string,
  overrides: Map<string, DailyRateRow> | undefined,
): ResolvedStayRates {
  const baseRate     = Number(roomType.base_rate     ?? 0);
  const baseExtraBed = Number(roomType.extrabed_rate ?? 0);

  const nights = listNights(checkIn, checkOut);
  const nightly: NightlyRate[] = [];
  const stopSellDates: string[] = [];
  let total = 0;
  let allBase = true;
  let maxMinStay = 1;

  for (const date of nights) {
    const ov = overrides?.get(date);
    if (ov) {
      allBase = false;
      const ebr = ov.extrabed_rate == null ? baseExtraBed : Number(ov.extrabed_rate);
      nightly.push({
        date,
        rate:          Number(ov.rate),
        extrabed_rate: ebr,
        source:        "daily_rate",
        stop_sell:     ov.stop_sell,
        min_stay:      ov.min_stay,
      });
      total += Number(ov.rate);
      if (ov.stop_sell) stopSellDates.push(date);
      if (ov.min_stay > maxMinStay) maxMinStay = ov.min_stay;
    } else {
      nightly.push({
        date,
        rate:          baseRate,
        extrabed_rate: baseExtraBed,
        source:        "base_rate",
        stop_sell:     false,
        min_stay:      1,
      });
      total += baseRate;
    }
  }

  return {
    room_type_id:    roomType.id,
    check_in:        checkIn,
    check_out:       checkOut,
    nights:          nights.length,
    nightly,
    total,
    has_stop_sell:   stopSellDates.length > 0,
    stop_sell_dates: stopSellDates,
    all_base:        allBase,
    max_min_stay:    maxMinStay,
  };
}

/**
 * One-shot helper: fetch overrides + resolve for a single room type.
 * Convenient for `create_booking` where only one room type is in flight.
 */
export async function calculateBookingRoomTotal(
  supabase: AnyClient,
  roomType: RoomTypeRow,
  checkIn:  string,
  checkOut: string,
): Promise<ResolvedStayRates> {
  const all = await getDailyRatesForRange(supabase, [roomType.id], checkIn, checkOut);
  return resolveRoomNightlyRates(roomType, checkIn, checkOut, all.get(roomType.id));
}
