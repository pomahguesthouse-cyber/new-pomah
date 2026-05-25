/**
 * Dispatch /api/queue-worker after enqueue.
 *
 * pg_net trigger is the primary path; this is a reliable fallback when pg_net
 * fails or when queue entries are stuck past max_wait_until.
 */
import { getWaitUntil } from "@/lib/cf-context";

export function dispatchQueueWorker(request: Request, entryId: string): void {
  const origin = new URL(request.url).origin;

  const work = async () => {
    try {
      const res = await fetch(`${origin}/api/queue-worker`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:   "INSERT",
          table:  "wa_conversation_queue",
          record: { id: entryId },
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`[QueueDispatch] worker HTTP ${res.status}: ${text.slice(0, 200)}`);
      } else {
        console.log(`[QueueDispatch] worker ${res.status} entry=${entryId.slice(0, 8)} body=${text.slice(0, 40)}`);
      }
    } catch (e) {
      console.error("[QueueDispatch] worker fetch failed:", e);
    }
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) waitUntil(work());
  else void work();
}
