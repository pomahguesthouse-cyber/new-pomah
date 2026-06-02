import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { drainQueue } from "@/services/wa-autoreply.service";

/**
 * Cron-driven queue drain.
 *
 * Invoked every 2s by the pg_cron job `drain-wa-queue` (see migration
 * 20260528120100_wa_queue_pg_cron_poll.sql). pg_cron's net.http_post cannot
 * easily carry a secret without vault setup, and this endpoint only drains
 * entries already validated and persisted in the DB queue via atomic claim
 * (FOR UPDATE SKIP LOCKED) — there is no inbound message vector here. Mirrors
 * the access posture of /api/queue-worker (hotfix 54a3274).
 */
async function handle(request: Request): Promise<Response> {
  await (supabaseAdmin as any).rpc("wa_queue_cleanup_zombies");
  const origin = new URL(request.url).origin;
  const { processed } = await drainQueue(origin);

  return new Response(JSON.stringify({ processed }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/process-wa-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
