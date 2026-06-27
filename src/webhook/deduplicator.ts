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

const _seenBody = new Map<string, number>();

/** Returns true if the exact same body was received from this sender within 30s. */
export function isDuplicateBody(sender: string, message: string): boolean {
  const key = `${sender}::${message.trim().toLowerCase()}`;
  const now = Date.now();

  for (const [k, ts] of _seenBody) {
    if (now - ts > 30_000) _seenBody.delete(k);
  }

  if (_seenBody.has(key)) return true;
  _seenBody.set(key, now);
  return false;
}

/**
 * Build a stable dedup key.
 * Prefer the Fonnte message ID; fall back to
 * "sender::body_prefix::timestamp_bucket" so legitimate repeated short
 * replies (e.g. "ya" / "ok" across distinct booking-flow turns within the
 * TTL window) are NOT swallowed. The 10s bucket still catches genuine
 * webhook retries (which land in the same bucket) while letting a new
 * user message a minute later through.
 */
const DEDUP_BUCKET_MS = 10_000;

export function buildDedupKey(
  fonnteId: string | undefined,
  sender:   string,
  message:  string,
  timestamp?: number,
): string {
  if (fonnteId) return fonnteId;
  const ts = timestamp ?? Date.now();
  const bucket = Math.floor(ts / DEDUP_BUCKET_MS);
  return `${sender}::${message.slice(0, 100)}::${bucket}`;
}
