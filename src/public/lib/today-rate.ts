/**
 * Harga efektif "hari ini" untuk tampilan publik (aman untuk browser).
 * Nilai today_rate diisi server dari room_daily_rates (lihat today-rate.server.ts).
 */
import type { DailyRateRow } from "@/services/pricing/daily-rate.service";
import { resolveRoomNightlyRates } from "@/services/pricing/daily-rate.service";
import { nextDay } from "@/lib/date";

export type TodayRateFields = {
  today_rate?: number | null;
  standard_rate?: number | null;
  rate_date?: string | null;
};

type RateSource = { base_rate?: number | string | null } & TodayRateFields;

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Harga tampil: today_rate bila ada, jika tidak base_rate. */
export function effectivePublicRate(room: RateSource | null | undefined): number | null {
  if (!room) return null;
  return positive(room.today_rate) ?? positive(room.base_rate);
}

/** Harga standar untuk dicoret, hanya bila tarif hari ini lebih murah. */
export function struckStandardRate(room: RateSource | null | undefined): number | null {
  if (!room) return null;
  const today = positive(room.today_rate);
  const standard = positive(room.standard_rate);
  return today != null && standard != null && today < standard ? standard : null;
}

/**
 * Tempelkan today_rate/standard_rate/rate_date ke setiap tipe kamar.
 * Tanpa override atau stop_sell hari ini → today_rate = base_rate.
 */
export function applyTodayRates<T extends { id: string; base_rate?: number | string | null }>(
  rooms: readonly T[],
  overrides: Map<string, Map<string, DailyRateRow>> | null,
  date: string,
): Array<T & Required<TodayRateFields>> {
  return rooms.map((room) => {
    const standard = positive(room.base_rate);
    let today = standard;
    const perRoom = overrides?.get(room.id);
    if (perRoom) {
      const resolved = resolveRoomNightlyRates(
        { id: room.id, name: "", base_rate: standard, capacity: null, bed_type: null, description: null },
        date,
        nextDay(date),
        perRoom,
      );
      const night = resolved.nightly[0];
      if (night && !resolved.has_stop_sell) today = positive(night.rate) ?? standard;
    }
    return { ...room, today_rate: today, standard_rate: standard, rate_date: date };
  });
}
