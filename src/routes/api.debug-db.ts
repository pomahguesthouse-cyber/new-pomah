import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  const webhookToken = process.env.FONNTE_WEBHOOK_TOKEN;

  if (!webhookToken || tokenParam !== webhookToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const report: Record<string, any> = {};

  try {
    // 1. Fetch managers
    const { data: managers, error: managerErr } = await (supabaseAdmin as any)
      .from("property_managers")
      .select("id, name, phone, role, is_active, telegram_chat_id");
    report.managers = managers;
    report.manager_error = managerErr ? managerErr.message : null;

    // 2. Fetch last 15 queue items
    const { data: queue, error: queueErr } = await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15);
    report.queue = queue;
    report.queue_error = queueErr ? queueErr.message : null;

    // 3. Fetch last 10 whatsapp messages
    const { data: messages, error: msgErr } = await (supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("id, thread_id, direction, body, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(15);
    report.messages = messages;
    report.messages_error = msgErr ? msgErr.message : null;

    // 4. Fetch properties timezone & configuration
    const { data: prop, error: propErr } = await (supabaseAdmin as any)
      .from("properties")
      .select("name, phone, whatsapp_number, timezone")
      .limit(1);
    report.property = prop?.[0];
    report.property_error = propErr ? propErr.message : null;

  } catch (err: any) {
    report.fatal_error = err.message;
  }

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/debug-db")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
    },
  },
});
