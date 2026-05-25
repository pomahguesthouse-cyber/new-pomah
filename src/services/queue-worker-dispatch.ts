/**
 * @deprecated Use scheduleAutoreply from wa-autoreply.service.ts
 */
import type { ScheduleAutoreplyParams } from "@/services/wa-autoreply.service";
import { scheduleAutoreply } from "@/services/wa-autoreply.service";

export function dispatchQueueWorker(
  request: Request,
  entryId: string,
  phone: string,
  body: string,
  smartDelayConfig: unknown,
): void {
  scheduleAutoreply(request, {
    phone,
    body,
    smartDelayConfig,
    queueEntryId: entryId,
  });
}
