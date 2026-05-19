/**
 * /api/fonnte — WhatsApp Webhook Endpoint
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  WEBHOOK HANDLER — deliberately lightweight                         │
 * │                                                                     │
 * │  Responsibilities (all < 200 ms):                                   │
 * │    1. Verify Fonnte token                                            │
 * │    2. Parse raw body → ParsedWebhookEvent                           │
 * │    3. Skip outgoing messages (sender === device)                    │
 * │    4. Deduplicate via in-memory Map                                 │
 * │    5. Persist inbound message to DB                                 │
 * │    6. Enqueue AI processing job                                     │
 * │    7. Return HTTP 200 immediately                                   │
 * │                                                                     │
 * │  Heavy work (AI, tool-calls, Fonnte send) is done by the           │
 * │  Supabase Edge Function `process-wa-queue` which is triggered       │
 * │  by a pg_net database webhook on wa_processing_queue INSERT.        │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * GET handlers provide debug / test utilities for local development.
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyFonnteToken }             from "@/webhook/verifier";
import { parseFonnteBody }               from "@/webhook/parser";
import { isDuplicate, buildDedupKey }    from "@/webhook/deduplicator";
import { classifyMessageIntent }          from "@/webhook/intent-classifier";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
}                                         from "@/repositories/message.repository";
import { enqueueProcessingJob }           from "@/repositories/queue.repository";

// ── AI (used only by GET ?test_reply=1 debug endpoint) ────────────────────────
import { runOrchestration, deriveAgentLabel } from "@/ai/orchestrator";
import { buildSystemPrompt }                  from "@/ai/context-builder";
import { TOOL_DEFINITIONS }                   from "@/tools/registry";
import { todayWIB }                           from "@/lib/date";

// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      // ══════════════════════════════════════════════════════════════════════
      //  POST — primary webhook receiver
      // ══════════════════════════════════════════════════════════════════════
      POST: async ({ request }) => {
        // 1. Verify token (log mismatch but do not reject — Fonnte is quirky)
        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        // 2. Parse body
        const event = await parseFonnteBody(request);
        if (!event) {
          console.log("[Webhook] empty or unparseable body — skipping");
          return new Response("OK", { status: 200 });
        }

        const { sender, message, name, fonnteId, isOutgoing } = event;

        console.log("[Webhook] received", {
          sender,
          isOutgoing,
          fonnteId,
          msg: message.slice(0, 60),
        });

        // 3. Skip outgoing messages (Fonnte webhooks our own sends too)
        if (isOutgoing) {
          console.log("[Webhook] outgoing detected (sender===device) — skipping");
          return new Response("OK", { status: 200 });
        }

        // 4. In-memory dedup (Layer 1 — same Worker instance)
        const dedupKey = buildDedupKey(fonnteId, sender, message);
        if (isDuplicate(dedupKey)) {
          console.log("[Webhook] duplicate key — skipping", dedupKey.slice(0, 40));
          return new Response("OK", { status: 200 });
        }

        // 5. Persist inbound message
        const { messageId, error: saveErr } = await saveInboundMessage(
          supabasePublic,
          { phone: sender, name, body: message },
        );

        if (saveErr) {
          console.error("[Webhook] saveInbound error:", saveErr.message);
          return new Response("Error", { status: 500 });
        }

        // 5a. Intent badge — fire-and-forget (non-critical metadata)
        if (messageId) {
          void saveMessageMetadata(supabasePublic, {
            messageId,
            metadata: { intent_label: classifyMessageIntent(message) },
          }).catch((e) => console.warn("[Webhook] intent metadata error:", e));
        }

        // 6. Enqueue AI processing job (triggers Edge Function via pg_net)
        const { queueId, error: qErr } = await enqueueProcessingJob(supabasePublic, {
          phone:     sender,
          messageId: messageId ?? null,
          body:      message,
        });

        if (qErr) {
          // Non-fatal: log and continue — the AI won't reply but the message is saved
          console.error("[Webhook] enqueueProcessingJob error:", qErr.message);
        } else {
          console.log("[Webhook] ✓ enqueued job", queueId, "for", sender);
        }

        // 7. Return 200 immediately — all heavy work is offloaded
        return new Response("OK", { status: 200 });
      },

      // ══════════════════════════════════════════════════════════════════════
      //  GET — debug & verification utilities
      // ══════════════════════════════════════════════════════════════════════
      GET: async ({ request }) => {
        const url = new URL(request.url);

        // Fonnte webhook verification handshake
        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyFonnteToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        // ── ?debug=1  Environment + connectivity report ───────────────────
        if (url.searchParams.get("debug") === "1") {
          const debugPhone = url.searchParams.get("phone") ?? "debug_test_000";
          const report: Record<string, unknown> = {
            env_token_set:           !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set:    !!process.env.SUPABASE_URL,
            env_supabase_key_set:    !!process.env.SUPABASE_PUBLISHABLE_KEY,
            env_lovable_api_key_set: !!process.env.LOVABLE_API_KEY,
            debug_phone: debugPhone,
          };

          if (debugPhone === "debug_test_000") {
            const { error } = await saveInboundMessage(supabasePublic, {
              phone: "debug_test_000",
              name:  "Debug Test",
              body:  "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_receive_ok    = !error;
            report.rpc_receive_error = error ? error.message : null;
          }

          try {
            const { data: ctx, error } = await (supabasePublic as any).rpc(
              "get_autoreply_context",
              { p_phone: debugPhone },
            );
            report.rpc_autoreply_ok    = !error;
            report.rpc_autoreply_error = error ? error.message : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set   = !!(c.fonnte_token as string)?.length;
              report.message_count      = Array.isArray(c.messages) ? c.messages.length : 0;
            }
          } catch (e) {
            report.rpc_autoreply_error = String(e);
          }

          const key = process.env.LOVABLE_API_KEY;
          if (key) {
            try {
              const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method:  "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body:    JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  max_tokens: 5,
                  messages: [{ role: "user", content: "ping" }],
                }),
              });
              report.llm_reachable = r.ok;
              report.llm_status    = r.status;
              if (!r.ok) report.llm_error = await r.text();
            } catch (e) {
              report.llm_reachable = false;
              report.llm_error     = String(e);
            }
          } else {
            report.llm_reachable = false;
            report.llm_error     = "LOVABLE_API_KEY not set";
          }

          return new Response(JSON.stringify(report, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── ?test_reply=1&phone=628xxx  Full AI dry-run (no send) ─────────
        if (url.searchParams.get("test_reply") === "1") {
          const testPhone = url.searchParams.get("phone");
          if (!testPhone) {
            return new Response(JSON.stringify({ error: "phone param required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const result: Record<string, unknown> = { phone: testPhone };

          try {
            const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
              "get_autoreply_context",
              { p_phone: testPhone },
            );

            if (ctxErr || !ctx) {
              result.error  = "get_autoreply_context failed";
              result.detail = ctxErr?.message ?? "null ctx";
            } else {
              const c = ctx as {
                auto_reply_enabled: boolean;
                fonnte_token:       string;
                messages:           Array<{ direction: string; body: string }>;
              };

              result.auto_reply_enabled = c.auto_reply_enabled;
              result.message_count      = c.messages?.length ?? 0;
              result.last_messages      = (c.messages ?? []).slice(-3).map((m) => ({
                direction: m.direction,
                body:      m.body?.slice(0, 60),
              }));

              if (!c.auto_reply_enabled) {
                result.skipped = "auto_reply_enabled is false";
              } else {
                // Fetch config needed by orchestrator
                const { data: prop } = await (supabasePublic as any)
                  .from("properties")
                  .select("*")
                  .limit(1)
                  .maybeSingle();
                const p = (prop ?? {}) as Record<string, unknown>;

                const explicitKey  = (p.ai_api_key as string | undefined)?.trim();
                const lovableKey   = process.env.LOVABLE_API_KEY?.trim();
                const useLovable   = !explicitKey && !!lovableKey;
                const apiKey       = explicitKey || lovableKey;

                if (!apiKey) {
                  result.error = "No AI key configured";
                } else {
                  const baseUrl = useLovable
                    ? "https://ai.gateway.lovable.dev/v1"
                    : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
                  const cfgModel = (p.ai_model as string | undefined)?.trim();
                  const model = useLovable
                    ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
                    : cfgModel || "gpt-4o-mini";

                  // Fetch rooms for system prompt and tools
                  const { data: rooms } = await (supabasePublic as any)
                    .from("room_types")
                    .select("id, name, base_rate, capacity, bed_type, description")
                    .order("base_rate");

                  const systemPrompt = buildSystemPrompt({
                    property:    p as any,
                    aiLabConfig: { agents: {}, tools: {} },
                    rooms:       rooms ?? [],
                    sopText:     "",
                  });

                  const t0 = Date.now();
                  const { reply, toolsUsed, error: orchErr } = await runOrchestration(
                    {
                      messages:     c.messages,
                      systemPrompt,
                      client:       { apiKey, baseUrl, model },
                      tools:        TOOL_DEFINITIONS,
                    },
                    {
                      supabasePublic: supabasePublic as any,
                      supabaseAdmin:  supabaseAdmin  as any,
                      rooms:          rooms ?? [],
                      property:       p as any,
                      today:          todayWIB(),
                    },
                  );

                  result.elapsed_ms = Date.now() - t0;
                  result.reply      = reply;
                  result.tools_used = toolsUsed;
                  result.reply_ok   = !!reply;
                  if (orchErr) result.error = orchErr;
                }
              }
            }
          } catch (e) {
            result.error = String(e);
          }

          return new Response(JSON.stringify(result, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Webhook is active", { status: 200 });
      },
    },
  },
});
