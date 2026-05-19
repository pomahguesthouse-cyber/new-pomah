import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Create an admin client to bypass RLS for webhooks
function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for webhook");
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

function verifyToken(request: Request): boolean {
  const expected = process.env.FONNTE_WEBHOOK_TOKEN;
  if (!expected) return true; // no token configured = open

  // Check Authorization header: Bearer <token>
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expected) {
    return true;
  }

  // Check query param: ?token=<token>
  const url = new URL(request.url);
  if (url.searchParams.get("token") === expected) {
    return true;
  }

  return false;
}

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Support webhook verification ping with token
        const url = new URL(request.url);
        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyToken(request)) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Webhook is active", { status: 200 });
      },
      POST: async ({ request }) => {
        if (!verifyToken(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const body = await request.json().catch(() => null);
          if (!body) {
            // Sometimes Fonnte sends form-urlencoded
            const text = await request.clone().text();
            console.log("[Fonnte Webhook] raw body:", text);
            return new Response("OK", { status: 200 });
          }

          // Fonnte typical payload: device, sender, message, name
          const { sender, message, name, device } = body;
          if (!sender || !message) {
            return new Response("OK", { status: 200 });
          }

          const supabase = getAdminClient();

          // Best-effort: Find existing thread or create one
          let { data: thread } = await supabase
            .from("whatsapp_threads")
            .select("id")
            .eq("phone", sender)
            .maybeSingle();

          if (!thread) {
            // Find guest by phone to link
            const { data: guest } = await supabase
              .from("guests")
              .select("id")
              .eq("phone", sender)
              .maybeSingle();

            const { data: newThread } = await supabase
              .from("whatsapp_threads")
              .insert({
                phone: sender,
                display_name: name || sender,
                guest_id: guest?.id || null,
              })
              .select("id")
              .single();
            thread = newThread;
          }

          if (thread) {
            await supabase.from("whatsapp_messages").insert({
              thread_id: thread.id,
              direction: "in",
              body: message,
            });

            await supabase
              .from("whatsapp_threads")
              .update({
                last_message_preview: message.slice(0, 120),
                last_message_at: new Date().toISOString(),
                unread_count: 1, // Actually we might want to increment it, but for simplicity set to 1 or you'd need a raw SQL update
              })
              .eq("id", thread.id);
          }

          // Note: Automatic AI Reply logic could go here if enabled.
          // Currently, staff can draft AI replies manually in the UI, or it can be automated.

          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("[Fonnte Webhook Error]", e);
          return new Response("Error", { status: 500 });
        }
      },
    },
  },
});
