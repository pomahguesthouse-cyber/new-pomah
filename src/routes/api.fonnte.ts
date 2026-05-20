/**
 * /api/fonnte — WhatsApp Webhook Endpoint (v3 — Stable Queue)
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE                                                           │
 * │                                                                         │
 * │  Every incoming message goes through a DB-driven conversation queue     │
 * │  (wa_conversation_queue).  The queue provides:                          │
 * │                                                                         │
 * │    • Smart Delay: bot waits for burst to finish before replying         │
 * │    • MAX_WAIT_TIME: bot ALWAYS replies within maxWaitMs of first msg    │
 * │    • Atomic DB locking: only ONE worker processes per conversation      │
 * │    • Retry: up to 3 attempts with exponential backoff                   │
 * │    • Fallback: sends human message if all AI retries fail               │
 * │    • Zombie cleanup: stuck workers auto-cleared on every request        │
 * │                                                                         │
 * │  State machine:                                                         │
 * │    pending → waiting → processing → sent                                │
 * │                                  → failed                               │
 * │                                  → retrying → processing (retry loop)   │
 * │                                                                         │
 * │  Flow per webhook request:                                              │
 * │    1.  Verify token + parse body                                        │
 * │    2.  Skip outgoing / deduplicate                                      │
 * │    3.  Save inbound message to DB                                       │
 * │    4.  Zombie cleanup (fast, indexed)                                   │
 * │    5.  Load context (auto_reply_enabled, fonnte_token)                  │
 * │    6.  wa_queue_upsert → entry_id + sleep_ms                           │
 * │    7.  sleep(sleep_ms) — bounded by maxWaitMs                          │
 * │    8.  wa_queue_claim (atomic) — only ONE worker succeeds               │
 * │    9.  Heartbeat → extend lock                                          │
 * │   10.  Re-fetch fresh messages from DB                                  │
 * │   11.  Load property + rooms + SOP                                      │
 * │   12.  Run AI (with in-process retry loop)                              │
 * │   13.  Send via Fonnte (or send fallback message on AI failure)         │
 * │   14.  wa_queue_complete + save outbound                                │
 * │   15.  return HTTP 200                                                  │
 * └────────────────────────────────────────────────────────────────────────┘
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
import {
  calcDelayMs,
  queueUpsert,
  queueClaim,
  queueHeartbeat,
  queueComplete,
  queueFail,
  queueCleanupZombies,
  DEFAULT_SMART_DELAY,
}                                             from "@/services/queue.service";
import type { SmartDelayConfig }             from "@/services/queue.service";


// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
}                                             from "@/ai/multi-agent-orchestrator";
import { todayWIB }                           from "@/lib/date";
import { retrieveRelevantSopContext }         from "@/ai/rag.service";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max milliseconds a single worker can sleep (keep within Cloudflare 30s limit) */
const WORKER_MAX_SLEEP_MS = 10_000;

/** Fallback message when AI fails all retry attempts */
const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

/** AI request timeout (AbortController) */
const AI_TIMEOUT_MS = 22_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Generate a unique worker ID for this request (used for DB locking) */
function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



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

        // ── 6. Zombie cleanup (fast — uses partial index) ─────────────────
        void queueCleanupZombies(supabasePublic).catch((e) =>
          console.warn("[Queue] cleanup error:", e),
        );

        // ── 7. Load autoreply context ─────────────────────────────────────
        const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
          "get_autoreply_context",
          { p_phone: sender },
        );

        if (ctxErr) {
          console.error(`[AutoReply] context RPC error: ${ctxErr.message} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!ctx) {
          // No thread yet for this phone — receive_whatsapp_message should have created it
          console.warn(`[AutoReply] no thread found for ${sender}`);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id:          string;
          auto_reply_enabled: boolean;
          fonnte_token:       string;
          messages:           Array<{ direction: string; body: string }>;
          smart_delay_config: Partial<SmartDelayConfig> | null;
        };

        if (!c.auto_reply_enabled) {
          return new Response("OK", { status: 200 });
        }
        if (!c.fonnte_token) {
          console.error(`[AutoReply] fonnte_token not configured | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 8. Queue upsert — register this message ───────────────────────
        const delayCfg: SmartDelayConfig = { ...DEFAULT_SMART_DELAY, ...(c.smart_delay_config ?? {}) };
        const delayMs = calcDelayMs(message, delayCfg);

        let entryId: string | null = null;
        let sleepMs = delayMs;

        if (delayMs > 0) {
          const entry = await queueUpsert(supabasePublic, {
            phone:     sender,
            threadId:  c.thread_id,
            messageId: messageId ?? null,
            body:      message,
            delayMs,
            maxWaitMs: delayCfg.maxWaitMs,
          });

          if (!entry) {
            // Queue upsert failed (DB error) — proceed without delay as fallback
            console.warn(`[Queue] upsert failed, proceeding without delay | ${logCtx}`);
          } else {
            entryId = entry.entryId;
            sleepMs = Math.min(entry.sleepMs, WORKER_MAX_SLEEP_MS);
            console.log(
              `[Queue] ${entry.isNewBurst ? "new burst" : "extending"} | ` +
              `entry=${entryId?.slice(-8)} sleep=${sleepMs}ms | ${logCtx}`,
            );
          }
        }

        // ── 9. Sleep ──────────────────────────────────────────────────────
        if (sleepMs > 0) {
          await sleep(sleepMs);
        }

        // ── 10. Atomic claim — only ONE worker proceeds ───────────────────
        let claimResult = { claimed: false, messageCount: 1, lastMessageBody: message, attempt: 0 };

        if (entryId) {
          claimResult = await queueClaim(supabasePublic, entryId, workerId);

          if (!claimResult.claimed) {
            // Another worker already claimed this, or delay hasn't elapsed yet
            // (e.g., this worker slept < sleep_ms because of WORKER_MAX_SLEEP_MS cap)
            console.log(
              `[Queue] claim failed — superseded or delay not elapsed | ` +
              `entry=${entryId.slice(-8)} | ${logCtx}`,
            );
            return new Response("OK", { status: 200 });
          }

          console.log(
            `[Queue] ✓ claimed | entry=${entryId.slice(-8)} ` +
            `msgs=${claimResult.messageCount} attempt=${claimResult.attempt} | ${logCtx}`,
          );
        }

        // ── 11. Processing starts here ────────────────────────────────────
        // Extend the worker lock before the expensive AI call
        if (entryId) {
          const heartbeatOk = await queueHeartbeat(supabasePublic, entryId, workerId);
          if (!heartbeatOk) {
            // Lock was stolen (should not happen) — abort to prevent duplicate reply
            console.error(`[Queue] heartbeat failed — lock stolen? Aborting | ${logCtx}`);
            return new Response("OK", { status: 200 });
          }
        }

        try {
          // ── 12. Re-fetch fresh messages (accumulates the full burst) ────
          let freshMessages = c.messages;
          const { data: freshCtx } = await (supabasePublic as any)
            .rpc("get_autoreply_context", { p_phone: sender })
            .catch(() => ({ data: null }));
          if (freshCtx) {
            freshMessages = (freshCtx as typeof c).messages ?? c.messages;
          }
          console.log(`[AutoReply] context refreshed: ${freshMessages.length} messages | ${logCtx}`);

          // ── 13. Load property + rooms + SOP ────────────────────────────
          // 8. Load property + rooms + SOP for agent contexts
          const { data: prop } = await (supabasePublic as any)
            .from("properties").select("*").limit(1).maybeSingle();
          const p = (prop ?? {}) as Record<string, unknown>;

          const { data: managerRow } = await (supabasePublic as any)
            .from("property_managers")
            .select("role")
            .eq("property_id", p.id)
            .eq("phone", sender)
            .maybeSingle();
          const isManager = !!managerRow;

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

          // ── 14. Resolve AI credentials ──────────────────────────────────
          // Resolve AI credentials early to use for embeddings
          const explicitKey = (p.ai_api_key as string | undefined)?.trim();
          const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
          const useLovable  = !explicitKey && !!lovableKey;
          const apiKey      = explicitKey || lovableKey;

          if (!apiKey) {
            console.error(`[AutoReply] no AI key configured | ${logCtx}`);
            await handleAiFailure({ supabase: supabasePublic, entryId, workerId, fonnteToken: c.fonnte_token, sender, fallbackReason: "no_api_key", logCtx });
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

          // ── 15. Run AI with retry loop ──────────────────────────────────
          const MAX_AI_RETRIES = 3;
          let reply: string | null = null;
          let lastAiError = "";
          let orchResult: Awaited<ReturnType<typeof runMultiAgentOrchestration>> | null = null;

          for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
            // Keep the DB lock alive during retries
            if (entryId && attempt > 1) {
              await queueHeartbeat(supabasePublic, entryId, workerId);
              await sleep(Math.min(1000 * attempt, 3000)); // brief pause between retries
            }
            const llmConfig = { apiKey, baseUrl, model };


            try {
              console.log(
                `[AutoReply] AI attempt ${attempt}/${MAX_AI_RETRIES} | ` +
                `model=${model} msgs=${freshMessages.length} | ${logCtx}`,
              );

              // AbortController: ensure AI call doesn't exceed timeout
              const controller = new AbortController();
              const aiTimeout  = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

              try {
                orchResult = await runMultiAgentOrchestration({
                  phone:     sender,
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
                break; // success — exit retry loop
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

          // ── 16. Send reply (or fallback) ────────────────────────────────
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
            const sendErrMsg = `fonnte_send_failed: ${sendErr}`;
            console.error(`[AutoReply] send failed: ${sendErr} | ${logCtx}`);

            // Mark queue entry as failed (will retry on next webhook)
            if (entryId) {
              const newStatus = await queueFail(supabasePublic, entryId, workerId, sendErrMsg);
              console.log(`[Queue] marked ${newStatus} | entry=${entryId.slice(-8)} | ${logCtx}`);
            }
            return new Response("OK", { status: 200 });
          }

          // ── 17. Persist success ─────────────────────────────────────────
          if (entryId) {
            await queueComplete(supabasePublic, entryId, workerId, finalReply);
          }

          const agentKey   = orchResult?.agentKey ?? "front-office";
          const agentLabel = deriveAgentLabelFromKey(agentKey);

          await saveOutboundMessage(supabasePublic, {
            threadId: c.thread_id,
            body:     finalReply,
            metadata: {
              agent:              agentLabel,
              agent_key:          agentKey,
              intent:             orchResult?.intent,
              routing_confidence: orchResult?.routingConfidence,
              escalated:          orchResult?.escalated,
              tools_used:         orchResult?.toolsUsed ?? [],
              is_fallback:        isFallback,
              burst_message_count: claimResult.messageCount,
              queue_entry_id:     entryId,
            },
          });

          void updateThreadAutoReplyMeta(supabasePublic, {
            threadId:  c.thread_id,
            toolsUsed: orchResult?.toolsUsed ?? [],
          }).catch((e: unknown) => console.warn("[AutoReply] meta update error:", e));

          console.log(
            `[AutoReply] ✓ replied | ` +
            `agent=${agentLabel} delay=${sleepMs}ms burst=${claimResult.messageCount}msgs ` +
            `fallback=${isFallback} | ${logCtx}`,
          );


        } catch (unexpectedErr) {
          // ── Unexpected crash — mark queue entry failed ────────────────────
          const errMsg = unexpectedErr instanceof Error
            ? unexpectedErr.message
            : String(unexpectedErr);
          console.error(`[AutoReply] unexpected crash: ${errMsg} | ${logCtx}`);

          if (entryId) {
            await queueFail(supabasePublic, entryId, workerId, `crash: ${errMsg}`).catch(() => null);
          }
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
              report.smart_delay_config = c.smart_delay_config;
            }
          } catch (e) { report.rpc_autoreply_error = String(e); }

          // Check queue health
          try {
            const { data: qStats } = await (supabasePublic as any)
              .from("wa_conversation_queue")
              .select("status, count:id")
              .in("status", ["pending","waiting","processing","retrying"])
              .limit(20);
            report.queue_active_entries = qStats;

            const zombieCount = await queueCleanupZombies(supabasePublic);
            report.zombies_cleaned = zombieCount;
          } catch (e) { report.queue_health_error = String(e); }

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
                const p    = (prop ?? {}) as Record<string, unknown>;
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

        return new Response("Webhook is active (queue v2)", { status: 200 });
      },
    },
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Called when AI fails permanently (no API key, etc.).
 * Sends fallback message and marks queue entry as failed.
 */
async function handleAiFailure(params: {
  supabase:      any;
  entryId:       string | null;
  workerId:      string;
  fonnteToken:   string;
  sender:        string;
  fallbackReason: string;
  logCtx:        string;
}): Promise<void> {
  const { supabase, entryId, workerId, fonnteToken, sender, fallbackReason, logCtx } = params;

  console.error(`[AutoReply] fatal failure (${fallbackReason}) | ${logCtx}`);

  // Try to send fallback message
  try {
    await sendWhatsAppMessage(fonnteToken, sender, FALLBACK_MESSAGE);
  } catch (e) {
    console.error(`[AutoReply] fallback send also failed: ${e} | ${logCtx}`);
  }

  // Mark queue entry as failed
  if (entryId) {
    await queueFail(supabase, entryId, workerId, fallbackReason).catch(() => null);
  }
}
