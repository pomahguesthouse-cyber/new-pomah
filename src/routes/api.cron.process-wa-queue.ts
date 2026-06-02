import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isInternalRouteAuthorized,
  unauthorizedInternalRouteResponse,
} from "@/lib/internal-route-auth";
import { drainQueue } from "@/services/wa-autoreply.service";

async function handle(request: Request): Promise<Response> {
  if (!isInternalRouteAuthorized(request)) {
    console.warn("[CronQueue] Unauthorized access attempt blocked");
    return unauthorizedInternalRouteResponse();
  }

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
