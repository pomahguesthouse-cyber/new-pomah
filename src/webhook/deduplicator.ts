/**
 * In-memory message deduplication (Layer 1).
 *
 * Uses a time-bucketed Map keyed on the Fonnte message ID when available,
 * or a content-derived key as fallback.  Entries expire after 5 minutes.
 *
 * NOTE: This is per-Worker-instance.  For cross-instance deduplication,
 * the DB-level processing queue (wa_processing_queue) provides a second
 * layer through its "newest wins" semantics.
 */

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

const _seen = new Map<string, number>();

/** Returns true if this key was already processed within the TTL window. */
export function isDuplicate(key: string): boolean {
  const now = Date.now();

  // Evict stale entries
  for (const [k, ts] of _seen) {
    if (now - ts > DEDUP_TTL_MS) _seen.delete(k);
  }

  if (_seen.has(key)) return true;
  _seen.set(key, now);
  return false;
}

/**
 * Build a stable dedup key.
 * Prefer the Fonnte message ID; fall back to "sender::body_prefix" so that
 * duplicate webhook deliveries without explicit IDs are still caught.
 */
export function buildDedupKey(
  fonnteId: string | undefined,
  sender:   string,
  message:  string,
): string {
  return fonnteId ?? `${sender}::${message.slice(0, 100)}`;
}
