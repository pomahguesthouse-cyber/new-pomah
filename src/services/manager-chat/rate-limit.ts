/**
 * Rate limit sederhana per nomor manajer (sliding window in-memory).
 * Melindungi dari webhook retry / perintah berulang yang membabi buta.
 * Reset otomatis saat proses restart — cukup sebagai pengaman awal.
 */

export const MANAGER_RATE_LIMIT = {
  windowMs: 5 * 60 * 1000,
  maxActions: 40,
  maxWrites: 15,
} as const;

type Stamp = { at: number; write: boolean };

const buckets = new Map<string, Stamp[]>();

export function resetManagerRateLimit(): void {
  buckets.clear();
}

export function checkManagerRateLimit(
  phone: string,
  opts?: { write?: boolean; now?: number },
): { ok: true } | { ok: false; retryAfterSec: number; reason: string } {
  const now = opts?.now ?? Date.now();
  const key = String(phone ?? "").replace(/\D/g, "") || String(phone ?? "");
  if (!key) return { ok: true };

  const cutoff = now - MANAGER_RATE_LIMIT.windowMs;
  const prior = (buckets.get(key) ?? []).filter((s) => s.at >= cutoff);
  const writes = prior.filter((s) => s.write).length;

  if (prior.length >= MANAGER_RATE_LIMIT.maxActions) {
    const retryAfterSec = Math.max(1, Math.ceil((prior[0].at + MANAGER_RATE_LIMIT.windowMs - now) / 1000));
    return { ok: false, retryAfterSec, reason: "Terlalu banyak perintah. Tunggu sebentar lalu coba lagi." };
  }
  if (opts?.write && writes >= MANAGER_RATE_LIMIT.maxWrites) {
    const firstWrite = prior.find((s) => s.write) ?? prior[0];
    const retryAfterSec = Math.max(1, Math.ceil((firstWrite.at + MANAGER_RATE_LIMIT.windowMs - now) / 1000));
    return { ok: false, retryAfterSec, reason: "Batas perintah ubah data tercapai. Tunggu sebentar lalu coba lagi." };
  }

  prior.push({ at: now, write: opts?.write === true });
  buckets.set(key, prior);
  return { ok: true };
}
