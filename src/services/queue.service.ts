/**
 * Conversation Queue Service — v2
 *
 * Thin TypeScript wrapper around the wa_conversation_queue SQL functions.
 * All heavy lifting (locking, state machine, atomicity) is done in Postgres.
 *
 * State machine:
 *   pending → waiting → processing → sent
 *                                 → failed
 *                                 → retrying → processing (retry loop)
 *
 * Key guarantees:
 *   1. Only ONE worker processes any given conversation (DB-level atomic claim)
 *   2. Bot ALWAYS replies within max_wait_ms of first message in burst
 *   3. Failed AI calls are retried up to max_attempts times
 *   4. Zombie workers are auto-cleaned after lock_expires_at
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SmartDelayConfig {
  enabled:       boolean;
  /** Delay for very short messages (<15 chars) */
  shortMs:       number;
  /** Delay for medium messages (15-80 chars) */
  mediumMs:      number;
  /** Delay for long messages (>80 chars) */
  longMs:        number;
  /** Delay when user signals they're not done ("bentar", "...") */
  waitSignalMs:  number;
  /** Hard cap on delay from first message in burst (prevents infinite reset) */
  maxWaitMs:     number;
}

export const DEFAULT_SMART_DELAY: SmartDelayConfig = {
  enabled:      true,
  shortMs:      2_000,
  mediumMs:     3_000,
  longMs:       4_000,
  waitSignalMs: 5_000,
  maxWaitMs:    8_000,   // Reduced from 20s to 8s to prevent Lovable edge timeout
};

/** Keywords/patterns that indicate user is still typing */
const WAIT_SIGNAL_RE =
  /\b(bentar|sebentar|tunggu|wait|lagi|masih|cek dulu|cek|nanti|sejenak|just a sec)\b|\.\.\./i;

export function calcDelayMs(body: string, cfg: SmartDelayConfig): number {
  if (!cfg.enabled) return 0;
  const text = body.trim();
  let base: number;
  if (WAIT_SIGNAL_RE.test(text))  base = cfg.waitSignalMs;
  else if (text.length < 15)      base = cfg.shortMs;
  else if (text.length <= 80)     base = cfg.mediumMs;
  else                             base = cfg.longMs;
  return Math.min(base, cfg.maxWaitMs);
}

/** Map properties.smart_delay_config (admin JSON) → queue timing. */
export function resolveQueueTiming(
  body: string,
  raw: Partial<{
    enabled: boolean;
    shortMs: number;
    mediumMs: number;
    longMs: number;
    waitSignalMs: number;
    maxDelayMs: number;
  }> | null | undefined,
): { delayMs: number; maxWaitMs: number } {
  const maxWaitMs = raw?.maxDelayMs ?? DEFAULT_SMART_DELAY.maxWaitMs;
  if (raw?.enabled === false) {
    return { delayMs: 0, maxWaitMs };
  }
  const delayMs = calcDelayMs(body, {
    enabled:      true,
    shortMs:      raw?.shortMs      ?? DEFAULT_SMART_DELAY.shortMs,
    mediumMs:     raw?.mediumMs     ?? DEFAULT_SMART_DELAY.mediumMs,
    longMs:       raw?.longMs       ?? DEFAULT_SMART_DELAY.longMs,
    waitSignalMs: raw?.waitSignalMs ?? DEFAULT_SMART_DELAY.waitSignalMs,
    maxWaitMs,
  });
  return { delayMs, maxWaitMs };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueueEntry {
  entryId:     string;
  /** How long this worker should sleep before claiming (ms) */
  sleepMs:     number;
  /** True = first message in a new burst; False = extending existing burst */
  isNewBurst:  boolean;
}

export interface ClaimResult {
  claimed:          boolean;
  messageCount:     number;
  lastMessageBody:  string;
  attempt:          number;
}

export interface ClaimNextResult {
  entryId:          string;
  phone:            string;
  threadId:         string;
  messageCount:     number;
  lastMessageBody:  string;
  attempt:          number;
}

export type QueueStatus =
  | "pending"
  | "waiting"
  | "processing"
  | "sent"
  | "failed"
  | "retrying";

// ─── Queue Service ────────────────────────────────────────────────────────────

/**
 * Register a new incoming message with the queue.
 *
 * Creates a new queue entry for this phone (new burst) or extends the delay
 * of an existing pending/waiting entry (same burst).
 * The delay is NEVER extended past max_wait_ms from the first message.
 */
export async function queueUpsert(
  supabase:  AnySupabase,
  params: {
    phone:      string;
    threadId:   string;
    messageId:  string | null;
    body:       string;
    delayMs:    number;
    maxWaitMs:  number;
  },
): Promise<QueueEntry | null> {
  const { data, error } = await supabase.rpc("wa_queue_upsert", {
    p_phone:       params.phone,
    p_thread_id:   params.threadId,
    p_message_id:  params.messageId ?? null,
    p_body:        params.body,
    p_delay_ms:    params.delayMs,
    p_max_wait_ms: params.maxWaitMs,
  });

  if (error) {
    console.error("[Queue] upsert error:", error.message, "| phone:", params.phone);
    return null;
  }

  // RPC returns array of rows (RETURNS TABLE)
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    entryId:    row.entry_id,
    sleepMs:    row.sleep_ms   ?? params.delayMs,
    isNewBurst: row.is_new_burst ?? true,
  };
}

/**
 * Atomically claim a queue entry for processing.
 *
 * Must be called AFTER the sleep window.
 * Uses DB-level locking — only ONE worker can succeed for any given entry.
 * Returns claimed=false if the entry was superseded or already claimed.
 */
export async function queueClaim(
  supabase:  AnySupabase,
  entryId:   string,
  workerId:  string,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("wa_queue_claim", {
    p_entry_id:  entryId,
    p_worker_id: workerId,
  });

  if (error) {
    console.error("[Queue] claim error:", error.message, "| entry:", entryId);
    return { claimed: false, messageCount: 0, lastMessageBody: "", attempt: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.claimed) {
    return { claimed: false, messageCount: 0, lastMessageBody: "", attempt: 0 };
  }

  return {
    claimed:         true,
    messageCount:    row.message_count    ?? 1,
    lastMessageBody: row.last_message_body ?? "",
    attempt:         row.attempt          ?? 1,
  };
}

/**
 * Atomically claim the next ready entry across ALL conversations.
 *
 * Picks the oldest entry whose idle window (process_after) has elapsed, or a
 * retrying entry whose backoff has elapsed. Uses FOR UPDATE SKIP LOCKED so
 * multiple worker instances can poll concurrently without blocking or
 * double-processing. Returns null when nothing is ready.
 *
 * This is the poll-based dispatcher primitive: the debounce window is enforced
 * purely by process_after in the DB, so workers never sleep inside a request.
 */
export async function queueClaimNext(
  supabase:  AnySupabase,
  workerId:  string,
): Promise<ClaimNextResult | null> {
  const { data, error } = await supabase.rpc("wa_queue_claim_next", {
    p_worker_id: workerId,
  });

  if (error) {
    console.error("[Queue] claim_next error:", error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.entry_id) return null;

  return {
    entryId:         row.entry_id,
    phone:           row.phone,
    threadId:        row.thread_id,
    messageCount:    row.message_count    ?? 1,
    lastMessageBody: row.last_message_body ?? "",
    attempt:         row.attempt          ?? 1,
  };
}

/**
 * Extend the worker's lock during a long AI operation.
 * Should be called before the AI call and optionally again mid-processing.
 * Returns false if the lock was somehow taken by another worker (should not happen).
 */
export async function queueHeartbeat(
  supabase:  AnySupabase,
  entryId:   string,
  workerId:  string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("wa_queue_heartbeat", {
    p_entry_id:  entryId,
    p_worker_id: workerId,
  });

  if (error) {
    console.warn("[Queue] heartbeat error:", error.message, "| entry:", entryId);
    return false;
  }
  return data === true;
}

/**
 * Mark the entry as successfully sent.
 * Persists the reply text for analytics.
 */
export async function queueComplete(
  supabase:  AnySupabase,
  entryId:   string,
  workerId:  string,
  reply:     string,
): Promise<void> {
  const { error } = await supabase.rpc("wa_queue_complete", {
    p_entry_id:  entryId,
    p_worker_id: workerId,
    p_reply:     reply,
  });

  if (error) {
    console.error("[Queue] complete error:", error.message, "| entry:", entryId);
  }
}

/**
 * Mark the entry as failed.
 * If attempts remain → transitions to 'retrying' with exponential backoff.
 * If no attempts remain → transitions to 'failed'.
 * Returns the new status.
 */
export async function queueFail(
  supabase:  AnySupabase,
  entryId:   string,
  workerId:  string,
  errorMsg:  string,
): Promise<QueueStatus> {
  const { data, error } = await supabase.rpc("wa_queue_fail", {
    p_entry_id:  entryId,
    p_worker_id: workerId,
    p_error:     errorMsg.slice(0, 500), // truncate for DB column
  });

  if (error) {
    console.error("[Queue] fail error:", error.message, "| entry:", entryId);
    return "failed";
  }
  return (data as QueueStatus) ?? "failed";
}

/**
 * Clean up zombie workers (processing entries whose lock expired).
 * Call on every webhook request — fast due to partial index.
 * Returns number of entries cleaned up (0 is normal).
 */
export async function queueCleanupZombies(supabase: AnySupabase): Promise<number> {
  const { data, error } = await supabase.rpc("wa_queue_cleanup_zombies");

  if (error) {
    console.warn("[Queue] cleanup error:", error.message);
    return 0;
  }
  const count = typeof data === "number" ? data : 0;
  if (count > 0) {
    console.warn("[Queue] ⚠️ cleaned up", count, "zombie worker(s)");
  }
  return count;
}

/**
 * Check if there's a retrying entry ready for pickup for this phone.
 * Called when a new message arrives — allows immediate retry rather than
 * waiting for the next webhook call.
 */
export async function queueGetRetrying(
  supabase: AnySupabase,
  phone:    string,
): Promise<{ entryId: string; attempt: number } | null> {
  const { data, error } = await supabase.rpc("wa_queue_get_retrying", {
    p_phone: phone,
  });

  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.entry_id) return null;
  return { entryId: row.entry_id, attempt: row.attempt };
}
