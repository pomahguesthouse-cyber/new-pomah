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

function isManualQueueRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("manual") === "1" ||
    request.headers.get("x-queue-manual") === "1"
  );
}

function authorizeQueueWorker(request: Request): Response | null {
  // Production must not drain through this endpoint anymore. Return a successful
  // disabled response for automatic/nudge calls BEFORE token validation, so old
  // webhook nudge calls do not produce noisy 403 logs and still cannot process
  // any queue entry.
  if (!isManualQueueRequest(request)) {
    return json({
      accepted: false,
      disabled: true,
      reason: "Automatic queue-worker drain is disabled. Production uses /api/cron/process-wa-queue only.",
    }, 202);
  }

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
 * Manual queue worker.
 *
 * Production drain is handled only by /api/cron/process-wa-queue to avoid two
 * independent worker triggers racing the same WhatsApp conversation. This route
 * is kept for manual/debug runs and requires both a valid token and manual=1
 * (or x-queue-manual: 1).
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
        return new Response(JSON.stringify({ processed, manual: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
