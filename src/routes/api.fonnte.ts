/**
 * /api/fonnte — WhatsApp Webhook Endpoint (v4 — No-Delay, Direct Reply)
 *
 * The smart-delay queue (wa_conversation_queue) was removed: claim races and
 * clock-drift edge cases caused silent no-reply failures. Bursts now get one
 * reply per inbound message; the in-memory dedup map still suppresses Fonnte
 * webhook duplicates.
 *
 * Flow per webhook request:
 *   1.  Verify Fonnte token
 *   2.  Parse body
 *   3.  Skip outgoing (Fonnte echoes our own sends)
 *   4.  In-memory dedup (5-min TTL)
 *   5.  Save inbound message
 *   6.  Load autoreply context
 *   7.  Run AI (with in-process retry loop)
 *   8.  Send via Fonnte (or fallback)
 *   9.  Save outbound + return 200
 */

import { createFileRoute }                   from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin }      from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyFonnteToken }                  from "@/webhook/verifier";
import { parseFonnteBody }                    from "@/webhook/parser";
import { isDuplicate, buildDedupKey }         from "@/webhook/deduplicator";
import { classifyMessageIntent }              from "@/webhook/intent-classifier";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
}                                             from "@/repositories/message.repository";

// ── Services ───────────────────────────────────────────────────────────────────
import { sendWhatsAppMessage }                from "@/services/whatsapp.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
}                                             from "@/ai/multi-agent-orchestrator";
import { todayWIB }                           from "@/lib/date";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fallback message when AI fails all retry attempts */
const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

/** AI request timeout (AbortController) */
const AI_TIMEOUT_MS = 22_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      // ══════════════════════════════════════════════════════════════════════
      //  POST — primary webhook receiver
      // ══════════════════════════════════════════════════════════════════════
      POST: async ({ request }) => {
        const workerId = newWorkerId();

        // ── 1. Token verification ─────────────────────────────────────────
        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        // ── 2. Parse body ─────────────────────────────────────────────────
        const event = await parseFonnteBody(request);
        if (!event) {
          return new Response("OK", { status: 200 });
        }

        const { sender, message, name, fonnteId, isOutgoing } = event;
        const logCtx = `phone=${sender.slice(-6)} worker=${workerId}`;
        const origin = new URL(request.url).origin;
        console.log("[Webhook]", { sender, isOutgoing, msg: message.slice(0, 60), origin });

        // ── 3. Skip outgoing (Fonnte webhooks our own sends) ──────────────
        if (isOutgoing) {
          return new Response("OK", { status: 200 });
        }

        // ── 4. In-memory dedup (fast, before any DB call) ─────────────────
        const dedupKey = buildDedupKey(fonnteId, sender, message);
        if (isDuplicate(dedupKey)) {
          console.log(`[Webhook] duplicate | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 5. Save inbound message ───────────────────────────────────────
        const { messageId, error: saveErr } = await saveInboundMessage(
          supabasePublic,
          { phone: sender, name, body: message },
        );
        if (saveErr) {
          console.error(`[Webhook] saveInbound failed: ${saveErr.message} | ${logCtx}`);
          return new Response("Error", { status: 500 });
        }

        // Intent badge (fire-and-forget — non-critical)
        if (messageId) {
          void saveMessageMetadata(supabasePublic, {
            messageId,
            metadata: { intent_label: classifyMessageIntent(message) },
          }).catch((e) => console.warn("[Webhook] intent badge error:", e));
        }

        // ── 6. Load autoreply context ─────────────────────────────────────
        const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
          "get_autoreply_context",
          { p_phone: sender },
        );

        if (ctxErr) {
          console.error(`[AutoReply] context RPC error: ${ctxErr.message} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!ctx) {
          console.warn(`[AutoReply] no thread found for ${sender}`);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id:          string;
          auto_reply_enabled: boolean;
          fonnte_token:       string;
          messages:           Array<{ direction: string; body: string }>;
        };

        if (!c.auto_reply_enabled) {
          console.log(`[AutoReply] auto_reply_enabled=false — skipping | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!c.fonnte_token) {
          console.error(`[AutoReply] fonnte_token not configured | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        try {
          // ── 7. Load property + rooms + SOP ─────────────────────────────
          const { data: prop } = await (supabasePublic as any)
            .from("properties").select("*").limit(1).maybeSingle();
          const p = (prop ?? {}) as Record<string, unknown>;

          const { data: rooms } = await (supabasePublic as any)
            .from("room_types")
            .select("id, name, base_rate, capacity, bed_type, description")
            .order("base_rate");

          // SOP text
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
                const content = (d.content as string | undefined)?.trim();
                const url     = (d.source_url as string | undefined)?.trim();
                if (!content && !url) continue;
                const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
                parts.push(content ? `${head}\n${content}` : head);
              }
              sopText = parts.join("\n\n").slice(0, 8000);
            } catch (e) {
              console.warn("[AutoReply] SOP load error:", e);
            }
          }

          // ── 8. Resolve AI credentials ──────────────────────────────────
          const explicitKey = (p.ai_api_key as string | undefined)?.trim();
          const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
          const useLovable  = !explicitKey && !!lovableKey;
          const apiKey      = explicitKey || lovableKey;

          if (!apiKey) {
            console.error(`[AutoReply] no AI key configured | ${logCtx}`);
            await sendWhatsAppMessage(c.fonnte_token, sender, FALLBACK_MESSAGE).catch(() => null);
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

          // ── 9. Run AI with retry loop ──────────────────────────────────
          const MAX_AI_RETRIES = 3;
          let reply: string | null = null;
          let lastAiError = "";
          let orchResult: Awaited<ReturnType<typeof runMultiAgentOrchestration>> | null = null;

          for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
            if (attempt > 1) {
              await sleep(Math.min(1000 * attempt, 3000));
            }

            try {
              console.log(
                `[AutoReply] AI attempt ${attempt}/${MAX_AI_RETRIES} | ` +
                `model=${model} msgs=${c.messages.length} | ${logCtx}`,
              );

              const controller = new AbortController();
              const aiTimeout  = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

              try {
                orchResult = await runMultiAgentOrchestration({
                  phone:     sender,
                  messages:  c.messages,
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
                    origin,
                  },
                  llmConfig: { apiKey, baseUrl, model },
                });
              } finally {
                clearTimeout(aiTimeout);
              }

              if (orchResult?.reply) {
                reply = orchResult.reply;
                console.log(
                  `[AutoReply] AI ok (attempt ${attempt}) | ` +
                  `agent=${orchResult.agentKey} intent=${orchResult.intent} ` +
                  `confidence=${orchResult.routingConfidence.toFixed(2)} | ${logCtx}`,
                );
                break;
              }

              lastAiError = orchResult?.error ?? "empty_reply";
              console.warn(`[AutoReply] AI attempt ${attempt} empty: ${lastAiError} | ${logCtx}`);
            } catch (e) {
              lastAiError = e instanceof Error ? e.message : String(e);
              const isAbort = lastAiError.includes("abort") || lastAiError.includes("AbortError");
              console.error(
                `[AutoReply] AI attempt ${attempt} threw (${isAbort ? "timeout" : "error"}): ` +
                `${lastAiError.slice(0, 120)} | ${logCtx}`,
              );
            }
          }

          // ── 10. Send reply (or fallback) ───────────────────────────────
          const finalReply = reply ?? FALLBACK_MESSAGE;
          const isFallback = !reply;

          if (isFallback) {
            console.error(
              `[AutoReply] ⚠️ AI failed all ${MAX_AI_RETRIES} attempts ` +
              `(${lastAiError}) — sending fallback | ${logCtx}`,
            );
          }

          const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
            c.fonnte_token, sender, finalReply,
          );

          if (!sent) {
            console.error(`[AutoReply] send failed: ${sendErr} | ${logCtx}`);
            return new Response("OK", { status: 200 });
          }

          // ── 11. Persist outbound ───────────────────────────────────────
          const agentKey   = orchResult?.agentKey ?? "front-office";
          const agentLabel = deriveAgentLabelFromKey(agentKey);

          await saveOutboundMessage(supabasePublic, {
            threadId: c.thread_id,
            body:     finalReply,
            metadata: {
              agent:              agentLabel,
              tools_used:         orchResult?.toolsUsed ?? [],
              ...({
                agent_key:          agentKey,
                intent:             orchResult?.intent,
                routing_confidence: orchResult?.routingConfidence,
                escalated:          orchResult?.escalated,
                is_fallback:        isFallback,
              } as any),
            },
          });

          void updateThreadAutoReplyMeta(supabasePublic, {
            threadId:  c.thread_id,
            toolsUsed: orchResult?.toolsUsed ?? [],
          }).catch((e: unknown) => console.warn("[AutoReply] meta update error:", e));

          console.log(
            `[AutoReply] ✓ replied | agent=${agentLabel} fallback=${isFallback} | ${logCtx}`,
          );
        } catch (unexpectedErr) {
          const errMsg = unexpectedErr instanceof Error
            ? unexpectedErr.message
            : String(unexpectedErr);
          console.error(`[AutoReply] unexpected crash: ${errMsg} | ${logCtx}`);
        }

        return new Response("OK", { status: 200 });
      },

      // ══════════════════════════════════════════════════════════════════════
      //  GET — debug, verification, and queue inspection
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
            }
          } catch (e) { report.rpc_autoreply_error = String(e); }

          const key = process.env.LOVABLE_API_KEY;
          if (key) {
            try {
              const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model:      "google/gemini-2.5-flash",
                  max_tokens: 5,
                  messages:   [{ role: "user", content: "ping" }],
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

        return new Response("Webhook is active (v4 — no-delay)", { status: 200 });
      },
    },
  },
});
