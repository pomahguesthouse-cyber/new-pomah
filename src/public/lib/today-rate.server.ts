/**
 * Muat tarif harian hari ini (WIB) untuk semua tipe kamar dalam satu query.
 * Kegagalan query tidak boleh merusak halaman: fallback ke base_rate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailyRatesForRange } from "@/services/pricing/daily-rate.service";
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
