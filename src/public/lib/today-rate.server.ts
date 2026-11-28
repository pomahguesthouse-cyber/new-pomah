/**
 * Muat tarif harian hari ini (WIB) untuk semua tipe kamar dalam satu query.
 * Kegagalan query tidak boleh merusak halaman: fallback ke base_rate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDailyRatesForRange,
  groupDailyRateRows,
  type DailyRateRow,
} from "@/services/pricing/daily-rate.service";
import { nextDay, todayWIB } from "@/lib/date";
import { applyTodayRates, type TodayRateFields } from "@/public/lib/today-rate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export async function attachTodayRates<T extends { id: string; base_rate?: number | string | null }>(
  client: AnyClient,
  rooms: readonly T[],
  date: string = todayWIB(),
): Promise<Array<T & Required<TodayRateFields>>> {
  const ids = rooms.map((room) => room.id).filter(Boolean);
  try {
    const overrides = await getDailyRatesForRange(client, ids, date, nextDay(date), { strict: true });
    return applyTodayRates(rooms, overrides, date);
  } catch {
    return applyTodayRates(rooms, null, date);
  }
}

/**
 * Semua override `room_daily_rates` untuk satu tanggal WIB, tanpa menunggu
 * daftar id kamar. Dipakai homepage agar tarif harian berjalan bersamaan
 * dengan query kamar. `null` berarti query gagal — pemanggil harus memakai
 * `attachTodayRates` (query tersaring yang sama) supaya harga tidak berubah.
 */
export async function loadTodayRateOverrideMap(
  client: AnyClient,
  date: string,
): Promise<Map<string, Map<string, DailyRateRow>> | null> {
  try {
    const { data, error } = await client
      .from("room_daily_rates")
      .select("room_type_id, date, rate, extrabed_rate, min_stay, stop_sell, note")
      .gte("date", date)
      .lt("date", nextDay(date));
    if (error) {
      console.error("[today-rate] today override query failed:", error.message);
      return null;
    }
    return groupDailyRateRows((data ?? []) as DailyRateRow[]);
  } catch (error) {
    console.error(
      "[today-rate] today override query failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
