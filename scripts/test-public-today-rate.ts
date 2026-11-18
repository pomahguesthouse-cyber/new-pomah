/**
 * Regresi: harga publik "hari ini" = room_daily_rates hari ini, fallback base_rate.
 */
import assert from "node:assert/strict";
import { applyTodayRates, effectivePublicRate, struckStandardRate } from "../src/public/lib/today-rate";
import { attachTodayRates } from "../src/public/lib/today-rate.server";
import type { DailyRateRow } from "../src/services/pricing/daily-rate.service";

const DATE = "2026-11-18";
const deluxe = { id: "deluxe-id", slug: "deluxe", base_rate: 230000 };

function overrides(row: Partial<DailyRateRow>): Map<string, Map<string, DailyRateRow>> {
  const full: DailyRateRow = { room_type_id: deluxe.id, date: DATE, rate: 207000, extrabed_rate: null, min_stay: 1, stop_sell: false, note: null, ...row };
  return new Map([[deluxe.id, new Map([[DATE, full]])]]);
}

// 1) Tarif harian 207000 menggantikan base 230000.
const [promo] = applyTodayRates([deluxe], overrides({}), DATE);
assert.equal(promo.today_rate, 207000);
assert.equal(promo.standard_rate, 230000);
assert.equal(promo.rate_date, DATE);
assert.equal(effectivePublicRate(promo), 207000);
assert.equal(struckStandardRate(promo), 230000);
console.log("✓ Deluxe harian 207000 → 207000");

// 2) Tanpa tarif harian → base_rate, tidak ada harga dicoret.
const [plain] = applyTodayRates([deluxe], new Map(), DATE);
assert.equal(effectivePublicRate(plain), 230000);
assert.equal(struckStandardRate(plain), null);
console.log("✓ tanpa harian → base_rate");

// 3) Stop sell hari ini → base_rate.
const [blocked] = applyTodayRates([deluxe], overrides({ stop_sell: true }), DATE);
assert.equal(effectivePublicRate(blocked), 230000);
console.log("✓ stop_sell → base_rate");

// 4) Query gagal → base_rate, tanpa error.
const failingClient = {
  from: () => ({ select: () => ({ in: () => ({ gte: () => ({ lt: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }),
};
const origError = console.error;
console.error = () => undefined;
const [errored] = await attachTodayRates(failingClient as never, [deluxe], DATE);
console.error = origError;
assert.equal(effectivePublicRate(errored), 230000);
console.log("✓ error query → base_rate");

// 5) Data tanpa today_rate (kode lama) tetap pakai base_rate.
assert.equal(effectivePublicRate({ base_rate: 230000 }), 230000);
console.log("✓ fallback field lama");
