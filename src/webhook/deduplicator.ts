/**
 * In-memory message deduplication (Layer 1).
 *
 * Uses a time-bucketed Map keyed on the Wpp message ID when available,
 * or a content-derived key as fallback. 
 * 
 * Optimized: Uses individual timers for cleanup instead of iterating
 * the entire map on every request, preventing CPU spikes on high traffic.
 */

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _seen = new Map<string, number>();
const _seenTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Returns true if this key was already processed within the TTL window. */
export function isDuplicate(key: string): boolean {
  if (_seen.has(key)) return true;

  const now = Date.now();
  _seen.set(key, now);

  // Individual cleanup timer
  const timer = setTimeout(() => {
    _seen.delete(key);
    _seenTimers.delete(key);
  }, DEDUP_TTL_MS);
  
  _seenTimers.set(key, timer);
  return false;
}

const _seenBody = new Map<string, number>();
const _seenBodyTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Returns true if the exact same body was received from this sender within 30s. */
export function isDuplicateBody(sender: string, message: string): boolean {
  const key = `${sender}::${message.trim().toLowerCase()}`;
  
  if (_seenBody.has(key)) return true;

  const now = Date.now();
  _seenBody.set(key, now);

  const timer = setTimeout(() => {
    _seenBody.delete(key);
    _seenBodyTimers.delete(key);
  }, 30_000);

  _seenBodyTimers.set(key, timer);
  return false;
}

/**
 * Build a stable dedup key.
 * Prefer the Wpp message ID; fall back to
 * "sender::body_prefix::timestamp_bucket"
 */
const DEDUP_BUCKET_MS = 10_000;

export function buildDedupKey(
  wppId: string | undefined,
  sender:   string,
  message:  string,
  timestamp?: number,
): string {
  if (wppId) return wppId;
  const ts = timestamp ?? Date.now();
  const bucket = Math.floor(ts / DEDUP_BUCKET_MS);
  return `${sender}::${message.slice(0, 100)}::${bucket}`;
}
