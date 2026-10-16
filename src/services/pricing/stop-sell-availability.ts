/**
 * Cap RPC stock (`room_type_availability_detail`) with `room_daily_rates.stop_sell`.
 *
 * The RPC is the inventory source of truth; stop-sell is a sales closure.
 * Applying the cap in code keeps every caller correct whether or not the
 * stop-sell-aware RPC migration (20261016120000) has been applied: with the
 * new RPC the cap is a no-op, with the old one it closes the gap.
 */
import { listNights } from "@/services/pricing/daily-rate.service";

export type StopSellRow = { date: string; stop_sell?: boolean | null };

export type CappedAvailability = {
  available: number;
  stop_sell_dates: string[];
};

/** Nights in [checkIn, checkOut) flagged stop_sell for one room type. */
export function stopSellNights(
  checkIn: string,
  checkOut: string,
  overrides: Map<string, StopSellRow> | undefined,
): string[] {
  if (!overrides) return [];
  return listNights(checkIn, checkOut).filter((d) => overrides.get(d)?.stop_sell === true);
}

/** Apply stop-sell to one room type's RPC `available` count. */
export function capAvailabilityWithStopSell(
  rpcAvailable: number,
  checkIn: string,
  checkOut: string,
  overrides: Map<string, StopSellRow> | undefined,
): CappedAvailability {
  const dates = stopSellNights(checkIn, checkOut, overrides);
  const base = Number.isFinite(rpcAvailable) ? Math.max(0, rpcAvailable) : 0;
  return { available: dates.length > 0 ? 0 : base, stop_sell_dates: dates };
}
