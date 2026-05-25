/**
 * Drain stuck WhatsApp queue entries (pending/waiting, ready to process).
 * Call periodically or once after deploy: GET /api/cron/process-wa-queue
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processWaQueueEntry } from "@/services/wa-queue-processor";

export const Route = createFileRoute("/api/cron/process-wa-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;

        await (supabaseAdmin as any).rpc("wa_queue_cleanup_zombies");

        const { data: rows, error } = await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .select("id, phone, status, process_after")
          .in("status", ["pending", "waiting"])
          .lte("process_after", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(20);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: { id: string; phone: string; status: number; body: string }[] = [];

        for (const row of rows ?? []) {
          const outcome = await processWaQueueEntry(row.id as string, origin);
          results.push({
            id:     row.id,
            phone:  row.phone,
            status: 200,
            body:   outcome,
          });
        }

        return new Response(
          JSON.stringify({ processed: results.length, results }, null, 2),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
