/**
 * Start queue processing in the background after enqueue.
 * Calls the processor directly (no HTTP self-fetch — unreliable on Cloudflare).
 */
import { getWaitUntil } from "@/lib/cf-context";
import { processWaQueueEntry } from "@/services/wa-queue-processor";

export function dispatchQueueWorker(request: Request, entryId: string): void {
  const origin = new URL(request.url).origin;

  const work = async () => {
    const outcome = await processWaQueueEntry(entryId, origin);
    console.log(`[QueueDispatch] entry=${entryId.slice(0, 8)} outcome=${outcome}`);
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) waitUntil(work());
  else void work();
}
