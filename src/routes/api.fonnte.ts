/**
 * /api/fonnte — WhatsApp Webhook Endpoint
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  WEBHOOK HANDLER                                                     │
 * │                                                                     │
 * │  Flow (synchronous — safe in Cloudflare Workers up to 30s):         │
 * │    1.  Verify Fonnte token                                           │
 * │    2.  Parse raw body → ParsedWebhookEvent                          │
 * │    3.  Skip outgoing messages (sender === device)                   │
 * │    4.  Deduplicate (in-memory Map, 5-min TTL)                       │
 * │    5.  Save inbound message to DB                                   │
 * │    6.  Load autoreply context (auto_reply_enabled, config, messages)│
 * │    7.  Smart Delay — sleep, then winner check                       │
 * │    8.  Multi-Agent Orchestration:                                   │
 * │          classify → route → agent(own prompt+tools) → reply        │
 * │    9.  Send reply via Fonnte                                        │
 * │   10.  Save outbound + return HTTP 200                              │
 * │                                                                     │
 * │  All AI logic is in typed modules (src/ai/, src/tools/, etc.)       │
 * │  — this file is only the HTTP boundary layer.                       │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyFonnteToken }          from "@/webhook/verifier";
import { parseFonnteBody }            from "@/webhook/parser";
import { isDuplicate, buildDedupKey } from "@/webhook/deduplicator";
import { classifyMessageIntent }       from "@/webhook/intent-classifier";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
}                                      from "@/repositories/message.repository";

// ── Services ───────────────────────────────────────────────────────────────────
import { sendWhatsAppMessage }         from "@/services/whatsapp.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
}                                      from "@/ai/multi-agent-orchestrator";
import { todayWIB }                    from "@/lib/date";

// ─── Smart Delay (in-process, no external deps needed) ────────────────────────

interface SmartDelayConfig {
  enabled:      boolean;
  shortMs:      number;
  mediumMs:     number;
  longMs:       number;
  waitSignalMs: number;
  maxDelayMs:   number;
}

const DEFAULT_DELAY: SmartDelayConfig = {
  enabled:      false,
  shortMs:      6000,
  mediumMs:     3000,
  longMs:       1000,
  waitSignalMs: 8000,
  maxDelayMs:   10000,
};

const WAIT_SIGNALS = /\b(bentar|sebentar|tunggu|wait|lagi|masih|cek dulu|cek)\b|\.\.\./i;

function calcDelayMs(body: string, cfg: SmartDelayConfig): number {
  if (!cfg.enabled) return 0;
  let base: number;
  if (WAIT_SIGNALS.test(body))       base = cfg.waitSignalMs;
  else if (body.trim().length < 15)  base = cfg.shortMs;
  else if (body.trim().length <= 80) base = cfg.mediumMs;
  else                               base = cfg.longMs;
  return Math.min(base, cfg.maxDelayMs);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── In-progress guard (same Worker instance) ─────────────────────────────────
const _inProgress = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      // ══════════════════════════════════════════════════════════════════════
      //  POST — primary webhook receiver
      // ══════════════════════════════════════════════════════════════════════
      POST: async ({ request }) => {
        // 1. Token verification
        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        // 2. Parse body
        const event = await parseFonnteBody(request);
        if (!event) {
          return new Response("OK", { status: 200 });
        }

        const { sender, message, name, fonnteId, isOutgoing } = event;
        console.log("[Webhook]", { sender, isOutgoing, msg: message.slice(0, 60) });

        // 3. Skip outgoing (Fonnte webhooks our own sends)
        if (isOutgoing) {
          console.log("[Webhook] outgoing — skipping");
          return new Response("OK", { status: 200 });
        }

        // 4. In-memory dedup
        const dedupKey = buildDedupKey(fonnteId, sender, message);
        if (isDuplicate(dedupKey)) {
          console.log("[Webhook] duplicate — skipping");
          return new Response("OK", { status: 200 });
        }

        // 5. Save inbound message
        const { messageId, error: saveErr } = await saveInboundMessage(
          supabasePublic,
          { phone: sender, name, body: message },
        );
        if (saveErr) {
          console.error("[Webhook] saveInbound error:", saveErr.message);
          return new Response("Error", { status: 500 });
        }

        // 5a. Intent badge — fire-and-forget
        if (messageId) {
          void saveMessageMetadata(supabasePublic, {
            messageId,
            metadata: { intent_label: classifyMessageIntent(message) },
          }).catch((e) => console.warn("[Webhook] intent badge error:", e));
        }

        // 6. Load autoreply context (auto_reply_enabled, fonnte_token, messages, delay_cfg)
        const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
          "get_autoreply_context",
          { p_phone: sender },
        );

        if (ctxErr) {
          console.error("[AutoReply] context error:", ctxErr);
          return new Response("OK", { status: 200 });
        }
        if (!ctx) {
          console.log("[AutoReply] no thread found for", sender);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id:          string;
          auto_reply_enabled: boolean;
          fonnte_token:       string;
          messages:           Array<{ direction: string; body: string }>;
          smart_delay_config: SmartDelayConfig | null;
        };

        if (!c.auto_reply_enabled) {
          console.log("[AutoReply] disabled — enable in AI Lab → Front Office Agent → Balas Otomatis");
          return new Response("OK", { status: 200 });
        }
        if (!c.fonnte_token) {
          console.error("[AutoReply] fonnte_token not set");
          return new Response("OK", { status: 200 });
        }

        // 7. Smart Delay — sleep then winner check
        const delayCfg: SmartDelayConfig = { ...DEFAULT_DELAY, ...(c.smart_delay_config ?? {}), enabled: false };
        const delayMs = calcDelayMs(message, delayCfg);
        let queueEntryId: string | null = null;

        if (delayMs > 0) {
          try {
            const { data: qid, error: qErr } = await (supabasePublic as any).rpc(
              "claim_queue_winner",
              {
                p_phone:      sender,
                p_message_id: messageId ?? null,
                p_body:       message,
                p_delay_ms:   delayMs,
                p_thread_id:  c.thread_id,
              },
            );
            if (qErr) {
              console.warn("[SmartDelay] claim error (migration missing?):", qErr);
            } else {
              queueEntryId = qid as string | null;
              console.log("[SmartDelay] sleeping", delayMs, "ms | queue:", queueEntryId);
              await sleep(delayMs);

              const { data: still } = await (supabasePublic as any).rpc(
                "is_still_winner",
                { p_entry_id: queueEntryId },
              );
              if (!still) {
                console.log("[SmartDelay] superseded — skipping");
                return new Response("OK", { status: 200 });
              }
            }
          } catch (e) {
            console.warn("[SmartDelay] error, continuing without delay:", e);
          }
        }

        // Re-fetch messages after sleep window so AI sees the full burst
        let freshMessages = c.messages;
        if (delayMs > 0) {
          const { data: freshCtx } = await (supabasePublic as any).rpc(
            "get_autoreply_context",
            { p_phone: sender },
          ).catch(() => ({ data: null }));
          if (freshCtx) {
            freshMessages = (freshCtx as typeof c).messages ?? c.messages;
            console.log("[SmartDelay] refreshed context:", freshMessages.length, "messages");
          }
        }

        // In-progress guard (same Worker instance)
        if (_inProgress.has(c.thread_id)) {
          console.log("[AutoReply] already in-progress:", c.thread_id, "— skipping");
          return new Response("OK", { status: 200 });
        }
        _inProgress.add(c.thread_id);

        try {
          // 8. Load property + rooms + SOP for agent contexts
          const { data: prop } = await (supabasePublic as any)
            .from("properties").select("*").limit(1).maybeSingle();
          const p = (prop ?? {}) as Record<string, unknown>;

          const { data: rooms } = await (supabasePublic as any)
            .from("room_types")
            .select("id, name, base_rate, capacity, bed_type, description")
            .order("base_rate");

          // SOP (only if enabled in ai_lab_config)
          const aiCfgRaw  = p.ai_lab_config as Record<string, unknown> | undefined;
          const sopEnabled = (aiCfgRaw?.tools as any)?.["sop-knowledge"]?.enabled ?? true;
          let sopText = "";
          if (sopEnabled) {
            try {
              const { data: sopDocs } = await (supabaseAdmin as any)
                .from("sop_documents")
                .select("name, content, source_url")
                .order("created_at", { ascending: true })
                .limit(40);
              const parts: string[] = [];
              for (const d of (sopDocs ?? []) as any[]) {
                const content = d.content?.trim();
                const url     = d.source_url?.trim();
                if (!content && !url) continue;
                const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
                parts.push(content ? `${head}\n${content}` : head);
              }
              sopText = parts.join("\n\n").slice(0, 8000);
            } catch (e) {
              console.warn("[AutoReply] SOP load error:", e);
            }
          }

          // Resolve AI credentials
          const explicitKey = (p.ai_api_key as string | undefined)?.trim();
          const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
          const useLovable  = !explicitKey && !!lovableKey;
          const apiKey      = explicitKey || lovableKey;

          if (!apiKey) {
            console.error("[AutoReply] No AI key configured");
            return new Response("OK", { status: 200 });
          }

          const baseUrl = useLovable
            ? "https://ai.gateway.lovable.dev/v1"
            : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1")
                .trim().replace(/\/+$/, "");
          const cfgModel = (p.ai_model as string | undefined)?.trim();
          const model = useLovable
            ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
            : cfgModel || "gpt-4o-mini";

          const today    = todayWIB();
          const roomList = (rooms ?? []) as any[];

          // 8. Run Multi-Agent Orchestration
          console.log(
            "[AutoReply] multi-agent pipeline | messages:", freshMessages.length,
            "| model:", model,
          );

          const result = await runMultiAgentOrchestration({
            messages:  freshMessages,
            agentCtx: {
              property:    p as any,
              rooms:       roomList,
              sopText,
              today,
              lastMessage: message,
            },
            toolCtx: {
              supabasePublic: supabasePublic as any,
              supabaseAdmin:  supabaseAdmin  as any,
              rooms:          roomList,
              property:       p as any,
              today,
            },
            llmConfig: { apiKey, baseUrl, model },
          });

          const { reply, toolsUsed, agentKey, intent, routingConfidence, escalated } = result;

          console.log(
            "[AutoReply] routed →", agentKey,
            "| intent:", intent,
            "| confidence:", routingConfidence.toFixed(2),
            "| escalated:", escalated,
            "| tools:", toolsUsed,
          );

          if (!reply) {
            console.error("[AutoReply] no reply generated — check AI key / LLM gateway");
            return new Response("OK", { status: 200 });
          }

          // 9. Send via Fonnte
          const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
            c.fonnte_token, sender, reply,
          );
          if (!sent) {
            console.error("[AutoReply] send failed:", sendErr);
            return new Response("OK", { status: 200 });
          }

          // Mark smart delay entry done
          if (queueEntryId) {
            void (supabasePublic as any).rpc("mark_queue_done", { p_entry_id: queueEntryId })
              .catch((e: unknown) => console.warn("[SmartDelay] mark_done error:", e));
          }

          // 10. Save outbound + update thread analytics
          const agentLabel = deriveAgentLabelFromKey(agentKey);
          await saveOutboundMessage(supabasePublic, {
            threadId: c.thread_id,
            body:     reply,
            metadata: {
              agent:              agentLabel,
              agent_key:          agentKey,
              intent,
              routing_confidence: routingConfidence,
              escalated,
              tools_used:         toolsUsed,
            },
          });
          void updateThreadAutoReplyMeta(supabasePublic, {
            threadId:  c.thread_id,
            toolsUsed,
          }).catch((e: unknown) => console.warn("[AutoReply] meta update error:", e));

          console.log(
            "[AutoReply] ✓ sent to", sender,
            "| delay:", delayMs, "ms",
            "| agent:", agentLabel,
            "| tools:", toolsUsed,
          );

        } finally {
          _inProgress.delete(c.thread_id);
        }

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

        // ── ?debug=1 ─────────────────────────────────────────────────────────
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
              "get_autoreply_context", { p_phone: debugPhone },
            );
            report.rpc_autoreply_ok    = !error;
            report.rpc_autoreply_error = error ? (error as any).message : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set   = !!(c.fonnte_token as string)?.length;
              report.message_count      = Array.isArray(c.messages) ? c.messages.length : 0;
              report.smart_delay_config = c.smart_delay_config;
            }
          } catch (e) { report.rpc_autoreply_error = String(e); }

          const key = process.env.LOVABLE_API_KEY;
          if (key) {
            try {
              const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({
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
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }

        // ── ?test_reply=1&phone=628xxx ────────────────────────────────────────
        if (url.searchParams.get("test_reply") === "1") {
          const testPhone = url.searchParams.get("phone");
          if (!testPhone) {
            return new Response(JSON.stringify({ error: "phone param required" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }

          const result: Record<string, unknown> = { phone: testPhone };
          try {
            const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
              "get_autoreply_context", { p_phone: testPhone },
            );
            if (ctxErr || !ctx) {
              result.error  = "get_autoreply_context failed";
              result.detail = (ctxErr as any)?.message ?? "null ctx";
            } else {
              const c = ctx as {
                auto_reply_enabled: boolean;
                fonnte_token:       string;
                messages:           Array<{ direction: string; body: string }>;
              };
              result.auto_reply_enabled = c.auto_reply_enabled;
              result.message_count      = c.messages?.length ?? 0;
              result.last_messages      = (c.messages ?? []).slice(-3).map((m) => ({
                direction: m.direction, body: m.body?.slice(0, 60),
              }));

              if (!c.auto_reply_enabled) {
                result.skipped = "auto_reply_enabled is false";
              } else {
                const { data: prop } = await (supabasePublic as any)
                  .from("properties").select("*").limit(1).maybeSingle();
                const p = (prop ?? {}) as Record<string, unknown>;
                const { data: rooms } = await (supabasePublic as any)
                  .from("room_types")
                  .select("id, name, base_rate, capacity, bed_type, description")
                  .order("base_rate");

                const explicitKey = (p.ai_api_key as string | undefined)?.trim();
                const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
                const useLovable  = !explicitKey && !!lovableKey;
                const apiKey      = explicitKey || lovableKey;

                if (!apiKey) {
                  result.error = "No AI key configured";
                } else {
                  const baseUrl = useLovable
                    ? "https://ai.gateway.lovable.dev/v1"
                    : ((p.ai_base_url as string) || "https://api.openai.com/v1").replace(/\/+$/, "");
                  const cfgModel = (p.ai_model as string | undefined)?.trim();
                  const model    = useLovable
                    ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
                    : cfgModel || "gpt-4o-mini";
                  const today    = todayWIB();
                  const roomList = (rooms ?? []) as any[];

                  const t0 = Date.now();
                  const orchResult = await runMultiAgentOrchestration({
                    messages:  c.messages,
                    agentCtx: {
                      property: p as any,
                      rooms:    roomList,
                      sopText:  "",
                      today,
                    },
                    toolCtx: {
                      supabasePublic: supabasePublic as any,
                      supabaseAdmin:  supabaseAdmin  as any,
                      rooms:          roomList,
                      property:       p as any,
                      today,
                    },
                    llmConfig: { apiKey, baseUrl, model },
                  });

                  result.elapsed_ms         = Date.now() - t0;
                  result.reply              = orchResult.reply;
                  result.tools_used         = orchResult.toolsUsed;
                  result.agent_key          = orchResult.agentKey;
                  result.intent             = orchResult.intent;
                  result.routing_confidence = orchResult.routingConfidence;
                  result.escalated          = orchResult.escalated;
                  result.reply_ok           = !!orchResult.reply;
                  if (orchResult.error) result.error = orchResult.error;
                }
              }
            }
          } catch (e) { result.error = String(e); }

          return new Response(JSON.stringify(result, null, 2), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Webhook is active", { status: 200 });
      },
    },
  },
});
