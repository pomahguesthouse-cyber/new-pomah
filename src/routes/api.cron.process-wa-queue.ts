import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { drainQueue } from "@/services/wa-autoreply.service";

/**
 * Cron-driven queue drain (the reliable idle-batching driver).
 *
 * Scheduled by pg_cron every couple of seconds. Cleans up zombie workers, then
 * drains every entry whose idle window has elapsed. GET and POST behave the
 * same so it can be hit by a browser, an external scheduler, or pg_net.
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
