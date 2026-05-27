import { createFileRoute } from "@tanstack/react-router";
import { drainQueue } from "@/services/wa-autoreply.service";

/**
 * Poll-based queue worker.
 *
 * Invoked by the pg_cron driver and the AFTER INSERT pg_net trigger. Drains all
 * currently-ready entries via atomic claim (FOR UPDATE SKIP LOCKED), so it is
 * safe to call concurrently from multiple instances and ignores the payload —
 * readiness is decided by process_after in the DB, not by the caller.
 */
export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const { processed } = await drainQueue(origin);
        return new Response(JSON.stringify({ processed }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
