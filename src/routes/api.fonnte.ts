import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";

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
        const url = new URL(request.url);

        // Challenge ping
        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        // Debug: ?debug=1 — tests Supabase connection + RPC, returns JSON report
        if (url.searchParams.get("debug") === "1") {
          const report: Record<string, unknown> = {
            env_token_set: !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set: !!process.env.SUPABASE_URL,
            env_supabase_key_set: !!process.env.SUPABASE_PUBLISHABLE_KEY,
          };

          try {
            const { error } = await supabasePublic.rpc("receive_whatsapp_message", {
              p_phone: "debug_test_000",
              p_name: "Debug Test",
              p_body: "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_ok = !error;
            report.rpc_error = error ? { code: error.code, message: error.message } : null;
          } catch (e) {
            report.rpc_ok = false;
            report.rpc_error = String(e);
          }

          return new Response(JSON.stringify(report, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Webhook is active", { status: 200 });
      },
      POST: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const tokenInUrl = reqUrl.searchParams.get("token");
        const envToken = process.env.FONNTE_WEBHOOK_TOKEN;
        console.log("[Fonnte Webhook] POST received", {
          token_in_url: tokenInUrl ? tokenInUrl.slice(0, 8) + "..." : null,
          env_token_set: !!envToken,
          token_match: !envToken || tokenInUrl === envToken,
          content_type: request.headers.get("content-type"),
        });

        if (!verifyToken(request)) {
          console.warn("[Fonnte Webhook] 401 — token mismatch");
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
            console.log("[Fonnte Webhook] JSON parsed", { sender, message: message?.slice(0, 30) });
          } else {
            const text = await request.text();
            const params = new URLSearchParams(text);
            sender = params.get("sender") ?? undefined;
            message = params.get("message") ?? undefined;
            name = params.get("name") ?? undefined;
            console.log("[Fonnte Webhook] form-urlencoded parsed", {
              raw: text.slice(0, 200),
              sender,
              message: message?.slice(0, 30),
            });
          }

          if (!sender || !message) {
            console.log("[Fonnte Webhook] missing sender or message, ignoring");
            return new Response("OK", { status: 200 });
          }

          const { error } = await supabasePublic.rpc("receive_whatsapp_message", {
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
