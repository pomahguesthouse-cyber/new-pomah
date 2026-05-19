import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";

async function generateAiReply(
  instructions: string,
  messages: Array<{ direction: string; body: string }>,
): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  const transcript = messages
    .map((m) => `${m.direction === "in" ? "Tamu" : "Host"}: ${m.body}`)
    .join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: instructions },
          {
            role: "user",
            content: `Riwayat percakapan:\n${transcript}\n\nBuat balasan berikutnya dari host.`,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[AutoReply] AI gateway error", res.status, await res.text());
      return null;
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error("[AutoReply] fetch error", e);
    return null;
  }
}

async function sendViaFonnte(token: string, phone: string, message: string): Promise<boolean> {
  try {
    const form = new URLSearchParams();
    form.append("target", phone);
    form.append("message", message);
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token },
      body: form,
    });
    if (!res.ok) console.error("[AutoReply] Fonnte send error", await res.text());
    return res.ok;
  } catch (e) {
    console.error("[AutoReply] Fonnte fetch error", e);
    return false;
  }
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
        const url = new URL(request.url);

        // Challenge ping
        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        // Debug: ?debug=1 — tests Supabase connection + RPC + auto-reply config
        if (url.searchParams.get("debug") === "1") {
          const report: Record<string, unknown> = {
            env_token_set: !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set: !!process.env.SUPABASE_URL,
            env_supabase_key_set: !!process.env.SUPABASE_PUBLISHABLE_KEY,
            env_lovable_api_key_set: !!process.env.LOVABLE_API_KEY,
          };

          // Test receive RPC
          try {
            const { error } = await supabasePublic.rpc("receive_whatsapp_message", {
              p_phone: "debug_test_000",
              p_name: "Debug Test",
              p_body: "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_receive_ok = !error;
            report.rpc_receive_error = error ? { code: error.code, message: error.message } : null;
          } catch (e) {
            report.rpc_receive_ok = false;
            report.rpc_receive_error = String(e);
          }

          // Test auto-reply context RPC
          try {
            const { data: ctx, error } = await supabasePublic.rpc("get_autoreply_context", {
              p_phone: "debug_test_000",
            });
            report.rpc_autoreply_ok = !error;
            report.rpc_autoreply_error = error ? { code: error.code, message: error.message } : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set = !!c.fonnte_token;
              report.instructions_set = !!(c.instructions as string)?.length;
              report.message_count = Array.isArray(c.messages) ? c.messages.length : 0;
            }
          } catch (e) {
            report.rpc_autoreply_ok = false;
            report.rpc_autoreply_error = String(e);
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
          // Log mismatch but still process — token is optional security layer.
          // Fonnte may not forward query params on POST in all configurations.
          console.warn("[Fonnte Webhook] token mismatch — processing anyway");
        }

        try {
          const rawText = await request.text();
          console.log("[Fonnte Webhook] raw body:", rawText.slice(0, 300));

          // Try JSON first regardless of Content-Type header
          // Fonnte sends JSON but may not set Content-Type: application/json
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(rawText);
          } catch {
            // Fall back to form-urlencoded
            const params = new URLSearchParams(rawText);
            for (const [k, v] of params.entries()) {
              body[k] = v;
            }
          }

          // Fonnte field names: sender/pengirim, message/pesan, name/pushname
          const sender =
            (body.sender as string) || (body.pengirim as string) || undefined;
          const message =
            (body.message as string) || (body.pesan as string) || undefined;
          const name =
            (body.name as string) || (body.pushname as string) || sender;

          console.log("[Fonnte Webhook] parsed fields", {
            sender,
            message: message?.slice(0, 50),
            name,
          });

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

          // Auto-reply: check if enabled for front-office agent
          try {
            const { data: ctx } = await supabasePublic.rpc("get_autoreply_context", {
              p_phone: sender,
            });

            if (ctx && (ctx as Record<string, unknown>).auto_reply_enabled) {
              const c = ctx as {
                thread_id: string;
                fonnte_token: string;
                instructions: string;
                messages: Array<{ direction: string; body: string }>;
              };

              const reply = await generateAiReply(c.instructions, c.messages);
              if (reply) {
                const sent = await sendViaFonnte(c.fonnte_token, sender, reply);
                if (sent) {
                  await supabasePublic.rpc("save_outbound_whatsapp", {
                    p_thread_id: c.thread_id,
                    p_body: reply,
                  });
                  console.log("[AutoReply] sent to", sender, ":", reply.slice(0, 60));
                }
              }
            }
          } catch (autoErr) {
            // Auto-reply failure must not break the main webhook response
            console.error("[AutoReply] error", autoErr);
          }

          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("[Fonnte Webhook Error]", e);
          return new Response("Error", { status: 500 });
        }
      },
    },
  },
});
