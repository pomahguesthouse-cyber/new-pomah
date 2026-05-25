import { createFileRoute } from "@tanstack/react-router";
import { processWaQueueEntry } from "@/services/wa-queue-processor";

export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = await request.json().catch(() => null);
          if (!payload?.record?.id) {
            return new Response("Invalid payload", { status: 400 });
          }

          const entryId = payload.record.id as string;
          const origin = new URL(request.url).origin;
          const outcome = await processWaQueueEntry(entryId, origin);

          const status =
            outcome === "claim_error" || outcome === "fatal" || outcome === "send_failed"
              ? 500
              : 200;
          return new Response(outcome, { status });
        } catch (err) {
          console.error("[QueueWorker] Fatal error:", err);
          return new Response("Fatal Error", { status: 500 });
        }
      },
    },
  },
});
