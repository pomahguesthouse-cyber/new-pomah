/**
 * Teks harga untuk tamu WhatsApp — satu sumber format.
 *
 * Acuan harga chatbot = kalender harga (`room_daily_rates`), fallback
 * `room_types.base_rate` hanya untuk tanggal tanpa harga kalender. Angka
 * per-malam selalu berasal dari `resolveRoomNightlyRates` (daily-rate.service)
 * — modul ini hanya memformat, tidak pernah menyimpan angka harga sendiri.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

export interface NightPrice {
  date: string;
  rate: number;
}

/** True bila harga per malam tidak seragam sepanjang menginap. */
export function hasVaryingRates(nightly: ReadonlyArray<NightPrice>): boolean {
  return new Set(nightly.map((n) => Number(n.rate))).size > 1;
}

/** Baris rincian per malam, mis. "  · 31 Okt: Rp150.000". */
export function formatNightlyBreakdownLines(nightly: ReadonlyArray<NightPrice>, indent = "  · "): string[] {
  return nightly.map((n) => `${indent}${shortDate(n.date)}: ${rp(Number(n.rate))}`);
}

/**
 * Teks harga satu tipe kamar dari payload `check_room_availability`.
 * - Harga seragam: ", Rp150.000/malam" (+ total bila > 1 malam).
 * - Harga beda per malam: total menginap + rincian per malam.
 */
export function formatRoomQuoteText(room: Record<string, unknown>): string {
  const perNight = Number(room.harga_per_malam ?? room.nightly_rate ?? 0);
  const nights = Number(room.malam ?? 0);
  const total = Number(room.total_rate ?? 0);
  const breakdownRaw = Array.isArray(room.nightly_breakdown) ? room.nightly_breakdown : null;
  const breakdown: NightPrice[] = (breakdownRaw ?? [])
    .map((n: any) => ({ date: String(n?.tanggal ?? n?.date ?? ""), rate: Number(n?.harga ?? n?.rate ?? 0) }))
    .filter((n) => n.date && Number.isFinite(n.rate));

  if (breakdown.length > 1 && hasVaryingRates(breakdown)) {
    const sum = total > 0 ? total : breakdown.reduce((s, n) => s + n.rate, 0);
    const detail = breakdown.map((n) => `${shortDate(n.date)} ${rp(n.rate)}`).join(", ");
    return `, total ${rp(sum)} untuk ${breakdown.length} malam (${detail})`;
  }
  if (perNight <= 0) return "";
  if (nights > 1 && total > 0) return `, ${rp(perNight)}/malam (total ${rp(total)} untuk ${nights} malam)`;
  return `, ${rp(perNight)}/malam`;
}

/** Kalimat harga ketika tamu belum menyebut tanggal. */
export function formatStartingFromPrice(baseRate: number): string {
  return baseRate > 0
    ? `mulai dari ${rp(baseRate)}/malam (harga mengikuti tanggal menginap)`
    : "harga mengikuti tanggal menginap";
}
