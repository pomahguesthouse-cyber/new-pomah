import { createFileRoute } from "@tanstack/react-router";
import { drainQueue } from "@/services/wa-autoreply.service";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function expectedQueueToken(): string | undefined {
  return process.env.QUEUE_WORKER_TOKEN || process.env.EVOLUTION_WEBHOOK_TOKEN || process.env.WPP_WEBHOOK_TOKEN;
}

function requestQueueToken(request: Request): string | null {
  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return url.searchParams.get("token") || authHeader || request.headers.get("x-queue-token");
}

function authorizeQueueWorker(request: Request): Response | null {
  const expected = expectedQueueToken();
  if (!expected) {
    return json({ error: "Queue worker token is not configured" }, 503);
  }
  if (requestQueueToken(request) !== expected) {
    return json({ error: "Unauthorized" }, 403);
  }
  return null;
}

/**
 * Poll-based queue worker.
 *
 * Invoked by pg_net triggers and trusted schedulers. The webhook itself remains
 * protected by Wpp token verification; this worker only drains entries that
 * already exist in the database queue via atomic claim (FOR UPDATE SKIP LOCKED).
 */
export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = authorizeQueueWorker(request);
        if (unauthorized) return unauthorized;

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
