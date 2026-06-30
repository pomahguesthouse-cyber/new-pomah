import { createFileRoute } from "@tanstack/react-router";
import { drainQueue } from "@/services/wa-autoreply.service";

/**
 * Poll-based queue worker.
 *
 * Invoked by pg_net triggers and trusted schedulers. The webhook itself remains
 * protected by Fonnte token verification; this worker only drains entries that
 * already exist in the database queue via atomic claim (FOR UPDATE SKIP LOCKED).
 */
export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = new URL(request.url).origin;
        // Keep each Worker invocation to one queue entry to avoid CPU-budget
        // eviction during heavy LLM/tool orchestration.
        const { processed } = await drainQueue(origin, 1, request.signal);
        return new Response(JSON.stringify({ processed }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
