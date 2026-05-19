/**
 * Processing queue repository.
 *
 * Manages the `wa_processing_queue` table — the job queue that decouples
 * the lightweight webhook handler from the heavy AI processing pipeline.
 *
 * Lifecycle of a queue entry:
 *   pending  →  processing  →  done
 *                           →  failed   (after max retries)
 *                           →  skipped  (superseded by newer message)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export type QueueEntryStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

export interface QueueEntry {
  id:          string;
  phone:       string;
  message_id:  string | null;
  body:        string;
  status:      QueueEntryStatus;
  attempts:    number;
  last_error:  string | null;
  created_at:  string;
  updated_at:  string;
}

export interface EnqueueResult {
  queueId: string | null;
  error:   Error  | null;
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Insert a new processing job.  Any pre-existing `pending` jobs for the
 * same phone are automatically superseded at the DB level (via the
 * `enqueue_processing_job` RPC).
 */
export async function enqueueProcessingJob(
  client: AnyClient,
  params: {
    phone:     string;
    messageId: string | null;
    body:      string;
  },
): Promise<EnqueueResult> {
  const { data, error } = await (client as any).rpc("enqueue_processing_job", {
    p_phone:      params.phone,
    p_message_id: params.messageId,
    p_body:       params.body,
  });

  if (error) {
    return {
      queueId: null,
      error:   new Error(`enqueue_processing_job: ${(error as any).message}`),
    };
  }

  return { queueId: data as string | null, error: null };
}

// ─── Status updates ───────────────────────────────────────────────────────────

export async function markQueueProcessing(
  client: AnyClient,
  queueId: string,
): Promise<void> {
  await (client as any)
    .from("wa_processing_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", queueId);
}

export async function markQueueDone(
  client: AnyClient,
  queueId: string,
): Promise<void> {
  await (client as any)
    .from("wa_processing_queue")
    .update({
      status:       "done",
      updated_at:   new Date().toISOString(),
    })
    .eq("id", queueId);
}

export async function markQueueFailed(
  client: AnyClient,
  queueId: string,
  error:   string,
): Promise<void> {
  await (client as any)
    .from("wa_processing_queue")
    .update({
      status:      "failed",
      last_error:  error,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", queueId);
}

export async function markQueueSkipped(
  client: AnyClient,
  queueId: string,
): Promise<void> {
  await (client as any)
    .from("wa_processing_queue")
    .update({ status: "skipped", updated_at: new Date().toISOString() })
    .eq("id", queueId);
}

// ─── Winner check ─────────────────────────────────────────────────────────────

/**
 * Returns true when this queue entry is the newest pending job for the
 * given phone — i.e. no later message has arrived since this one was queued.
 *
 * This is the Smart Delay "winner" check at the DB level.
 */
export async function isNewestPendingForPhone(
  client: AnyClient,
  params: { queueId: string; phone: string },
): Promise<boolean> {
  const { data, error } = await (client as any).rpc(
    "is_newest_pending_for_phone",
    { p_queue_id: params.queueId, p_phone: params.phone },
  );
  if (error) {
    console.error("[QueueRepo] isNewestPending error:", error);
    return true; // fail-open: proceed with reply rather than silently drop
  }
  return data === true;
}
