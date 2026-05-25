import { createFileRoute } from "@tanstack/react-router";
import { scheduleAutoreply } from "@/services/wa-autoreply.service";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** pg_net / cron entry — delegates to the same autoreply pipeline as the webhook. */
export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = await request.json().catch(() => null);
        if (!payload?.record?.id) {
          return new Response("Invalid payload", { status: 400 });
        }

        const entryId = payload.record.id as string;
        const { data: row } = await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .select("phone, last_message_body")
          .eq("id", entryId)
          .maybeSingle();

        if (!row?.phone) {
          return new Response("Gone", { status: 200 });
        }

        const { data: prop } = await (supabaseAdmin as any)
          .from("properties")
          .select("smart_delay_config")
          .limit(1)
          .maybeSingle();

        scheduleAutoreply(request, {
          phone:            row.phone,
          body:             row.last_message_body ?? "",
          smartDelayConfig: prop?.smart_delay_config,
          queueEntryId:     entryId,
        });

        return new Response("Scheduled", { status: 200 });
      },
    },
  },
});
