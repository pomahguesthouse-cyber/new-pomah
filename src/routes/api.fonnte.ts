import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Use anon key — inserts are done via SECURITY DEFINER RPC, no service_role needed
function getAnonClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
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
          const contentType = request.headers.get("content-type") ?? "";
          let sender: string | undefined;
          let message: string | undefined;
          let name: string | undefined;

          if (contentType.includes("application/json")) {
            const body = await request.json().catch(() => ({}));
            sender = body.sender;
            message = body.message;
            name = body.name;
          } else {
            // Fonnte sends form-urlencoded by default
            const text = await request.text();
            const params = new URLSearchParams(text);
            sender = params.get("sender") ?? undefined;
            message = params.get("message") ?? undefined;
            name = params.get("name") ?? undefined;
            console.log("[Fonnte Webhook] form body:", text);
          }
          if (!sender || !message) {
            console.log("[Fonnte Webhook] missing sender or message, ignoring");
            return new Response("OK", { status: 200 });
          }

          const supabase = getAnonClient();

          const { error } = await supabase.rpc("receive_whatsapp_message", {
            p_phone: sender,
            p_name: name ?? sender,
            p_body: message,
          });

          if (error) {
            console.error("[Fonnte Webhook] RPC error:", error);
            return new Response("Error", { status: 500 });
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
