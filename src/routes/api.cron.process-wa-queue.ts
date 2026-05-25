import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scheduleAutoreply } from "@/services/wa-autoreply.service";

export const Route = createFileRoute("/api/cron/process-wa-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await (supabaseAdmin as any).rpc("wa_queue_cleanup_zombies");

        const { data: rows } = await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .select("id, phone, last_message_body, status, process_after")
          .in("status", ["pending", "waiting"])
          .lte("process_after", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(10);

        const { data: prop } = await (supabaseAdmin as any)
          .from("properties")
          .select("smart_delay_config")
          .limit(1)
          .maybeSingle();

        const results: { id: string; phone: string }[] = [];
        for (const row of rows ?? []) {
          scheduleAutoreply(request, {
            phone:            row.phone,
            body:             row.last_message_body ?? "",
            smartDelayConfig: prop?.smart_delay_config,
            queueEntryId:     row.id,
          });
          results.push({ id: row.id, phone: row.phone });
        }

        return new Response(
          JSON.stringify({ scheduled: results.length, results }, null, 2),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
