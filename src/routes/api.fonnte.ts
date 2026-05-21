/**
 * /api/fonnte — WhatsApp Webhook Endpoint (v5 — Production Reliable, Safe Direct Reply)
 *
 * Implements high-reliability features:
 *   1.  Proper AbortController propagation for LLM timeouts
 *   2.  Lightweight Last-One-Wins smart debounce (2-4 seconds aggregation window)
 *   3.  Rolling conversation context window limit (last 20 messages)
 *   4.  Graceful, in-memory TTL caching for SOP documents
 *   5.  Secure admin debug checks via FONNTE_WEBHOOK_TOKEN validation
 *   6.  Outbound message idempotency filtering (preventing duplicate sends)
 *   7.  AI Gateway circuit breaker and automatic cooldown fallback
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

// ─── Global Cache & Fault Tolerance State ─────────────────────────────────────

interface SopCache {
  docs: any[];
  fetchedAt: number;
}

let globalSopCache: SopCache | null = null;
const SOP_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

/**
 * Identify a brochure doc by doc_category OR by its storage path prefix.
 * The path-based check handles files uploaded before the doc_category column
 * was migrated (those have doc_category = null or 'sop').
 */
function isBrosurDoc(d: Record<string, unknown>): boolean {
  if ((d.doc_category as string) === "brosur") return true;
  const fp = (d.file_path as string | null) ?? "";
  return fp.startsWith("brosur/");
}

/** Circuit breaker status */
let aiFailureCount = 0;
let aiCooldownUntil = 0;
const MAX_AI_FAILURES = 5;
const COOLDOWN_DURATION_MS = 60 * 1000; // 1 minute cooldown

/** Outbound WhatsApp message idempotency map */
const outboundDedup = new Map<string, number>(); // key: `out:${sender}:${hash(reply)}`, value: timestamp
const OUTBOUND_DEDUP_TTL_MS = 15 * 1000; // 15 seconds TTL

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Simple hash helper to fingerprint outgoing message bodies
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

/** Fallback helper that sends a fallback reply and persists it to the database */
async function sendFallbackAndSave(
  token: string,
  sender: string,
  threadId: string,
  logCtx: string
): Promise<void> {
  const { ok: sent, error: sendErr } = await sendWhatsAppMessage(token, sender, FALLBACK_MESSAGE);
  if (!sent) {
    console.error(`[AutoReply] Fallback send failed: ${sendErr} | ${logCtx}`);
    return;
  }
  await saveOutboundMessage(supabasePublic, {
    threadId,
    body:     FALLBACK_MESSAGE,
    metadata: {
      agent:              "Front Office Agent",
      tools_used:         [],
      agent_key:          "front-office",
      is_fallback:        true,
    } as any,
  });
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

        const { sender, message, name, fonnteId, isOutgoing, customerPhone, rawBody } = event;
        const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;
        const origin = new URL(request.url).origin;
        console.log("[Webhook]", { sender, customerPhone, isOutgoing, msg: message.slice(0, 60), rawBodyKeys: Object.keys(rawBody) });

        // ── 3. Handle outgoing (Fonnte webhooks our own sends + native phone sends) ──
        if (isOutgoing) {
          try {
            const { data: thread } = await (supabaseAdmin as any)
              .from("whatsapp_threads")
              .select("id")
              .eq("phone", customerPhone)
              .maybeSingle();

            let threadId = thread?.id;

            if (!threadId) {
              const { data: newThread } = await (supabaseAdmin as any)
                .from("whatsapp_threads")
                .insert({ phone: customerPhone, display_name: name || customerPhone, status: "open", unread_count: 0 })
                .select("id")
                .single();
              threadId = newThread?.id;
            }

            if (threadId) {
              const twoMinsAgo = new Date(Date.now() - 2 * 60000).toISOString();
              const { data: existingMsg } = await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .select("id")
                .eq("thread_id", threadId)
                .eq("direction", "out")
                .eq("body", message)
                .gte("sent_at", twoMinsAgo)
                .maybeSingle();

              if (!existingMsg) {
                console.log(`[Webhook] Saving native outbound human message | ${logCtx}`);
                await (supabaseAdmin as any).rpc("save_outbound_whatsapp", {
                  p_thread_id: threadId,
                  p_body: message,
                  p_metadata: { is_native_human: true },
                });
              } else {
                console.log(`[Webhook] Ignored outgoing echo (already in DB) | ${logCtx}`);
              }
            }
          } catch (err) {
            console.error(`[Webhook] Error handling native outgoing message: ${err} | ${logCtx}`);
          }
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
          { phone: customerPhone, name, body: message },
        );
        if (saveErr || !messageId) {
          console.error(`[Webhook] saveInbound failed: ${saveErr?.message ?? "no messageId"} | ${logCtx}`);
          return new Response("Error", { status: 500 });
        }

        // Intent badge (fire-and-forget — non-critical)
        void saveMessageMetadata(supabasePublic, {
          messageId,
          metadata: { intent_label: classifyMessageIntent(message) },
        }).catch((e) => console.warn("[Webhook] intent badge error:", e));

        // ── 6. Load autoreply context ─────────────────────────────────────
        const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
          "get_autoreply_context",
          { p_phone: customerPhone },
        );

        if (ctxErr) {
          console.error(`[AutoReply] context RPC error: ${ctxErr.message} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!ctx) {
          console.warn(`[AutoReply] no thread found for ${customerPhone}`);
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

        // ── 7. Lightweight Smart Debounce (Last-One-Wins) ─────────────────
        const DEBOUNCE_MS = 3000;
        console.log(`[AutoReply] debouncing ${DEBOUNCE_MS}ms | thread=${c.thread_id} | ${logCtx}`);
        await sleep(DEBOUNCE_MS);

        // Fetch latest inbound message ID to check if a newer message superseded this handler
        const { data: latestInbound, error: latestErr } = await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .select("id")
          .eq("thread_id", c.thread_id)
          .eq("direction", "in")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestErr) {
          console.error(`[AutoReply] debounce query error: ${latestErr.message} | ${logCtx}`);
        }


        if (latestInbound && latestInbound.id !== messageId) {
          console.log(`[AutoReply] superseded by newer message (${latestInbound.id}) — aborting execution | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 8. AI Cooldown Circuit Breaker Check ──────────────────────────
        const nowMs = Date.now();
        if (nowMs < aiCooldownUntil) {
          console.error(
            `[AutoReply] Circuit Breaker active (cooldown until ${new Date(aiCooldownUntil).toISOString()}) ` +
            `— bypassing AI and using fallback | ${logCtx}`,
          );
          await sendFallbackAndSave(c.fonnte_token, customerPhone, c.thread_id, logCtx);
          return new Response("OK", { status: 200 });
        }

        try {
          // Load property + rooms data
          const { data: prop } = await (supabasePublic as any)
            .from("properties").select("*").limit(1).maybeSingle();
          const p = (prop ?? {}) as Record<string, unknown>;

          const { data: rooms } = await (supabasePublic as any)
            .from("room_types")
            .select("id, name, base_rate, capacity, bed_type, description, amenities")
            .order("base_rate");

          // ── 9. Load SOP Documents (TTL Cached) ──────────────────────────
          const aiCfgRaw  = p.ai_lab_config as Record<string, unknown> | undefined;
          const sopEnabled = (aiCfgRaw?.tools as any)?.["sop-knowledge"]?.enabled ?? true;
          let sopText = "";
          if (sopEnabled) {
            let sopDocs: any[] = [];
            if (globalSopCache && (nowMs - globalSopCache.fetchedAt < SOP_CACHE_TTL_MS)) {
              sopDocs = globalSopCache.docs;
            } else {
              try {
                const { data: fetchedDocs, error: fetchErr } = await (supabaseAdmin as any)
                  .from("sop_documents")
                  .select("name, content, source_url, file_path, doc_category")
                  .order("created_at", { ascending: true })
                  .limit(40);
                if (fetchErr) throw fetchErr;

                sopDocs = fetchedDocs ?? [];
                globalSopCache = { docs: sopDocs, fetchedAt: nowMs };
              } catch (e) {
                console.warn("[AutoReply] SOP load failed, using cache fallback:", e);
                if (globalSopCache) {
                  sopDocs = globalSopCache.docs;
                }
              }
            }

            const parts: string[] = [];
            for (const d of sopDocs) {
              if (isBrosurDoc(d)) continue;
              const content = (d.content as string | undefined)?.trim();
              const url     = (d.source_url as string | undefined)?.trim();
              if (!content && !url) continue;
              const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
              parts.push(content ? `${head}\n${content}` : head);
            }
            sopText = parts.join("\n\n").slice(0, 8000);
          }

          // ── 9b. Build brochure file list with public URLs ────────────────
          const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
          const brosurFiles: { name: string; url: string }[] = [];
          if (globalSopCache) {
            for (const d of globalSopCache.docs) {
              if (!isBrosurDoc(d)) continue;
              const fp = (d.file_path as string | undefined)?.trim();
              if (!fp) continue;
              brosurFiles.push({
                name: d.name as string,
                url: `${supabaseUrl}/storage/v1/object/public/sop-documents/${fp}`,
              });
            }
          }

          // ── 10. AI Gateway Credentials ──────────────────────────────────
          const explicitKey = (p.ai_api_key as string | undefined)?.trim();
          const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
          const useLovable  = !explicitKey && !!lovableKey;
          const apiKey      = explicitKey || lovableKey;

          if (!apiKey) {
            console.error(`[AutoReply] no AI key configured | ${logCtx}`);
            await sendFallbackAndSave(c.fonnte_token, customerPhone, c.thread_id, logCtx);
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

          // ── 11. Limit context to rolling window (last 20 messages) ───────
          const rollingMessages = (c.messages ?? []).slice(-20);

          // ── 12. Run AI with retry loop & AbortController ────────────────
          const MAX_AI_RETRIES = 3;
          let reply: string | null = null;
          let lastAiError = "";
          let orchResult: Awaited<ReturnType<typeof runMultiAgentOrchestration>> | null = null;

          for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
            if (attempt > 1) {
              await sleep(Math.min(1000 * attempt, 3000));
            }

            const controller = new AbortController();
            const aiTimeout  = setTimeout(() => {
              controller.abort();
              console.warn(`[AutoReply] AI execution timeout triggered (${AI_TIMEOUT_MS}ms) | ${logCtx}`);
            }, AI_TIMEOUT_MS);

            try {
              console.log(
                `[AutoReply] AI attempt ${attempt}/${MAX_AI_RETRIES} | ` +
                `model=${model} msgs=${rollingMessages.length} | ${logCtx}`,
              );

              orchResult = await runMultiAgentOrchestration({
                phone:     customerPhone,
                messages:  rollingMessages,
                agentCtx: {
                  property:    p as any,
                  rooms:       roomList,
                  sopText,
                  brosurFiles,
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
                signal: controller.signal,
              });

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
            } finally {
              clearTimeout(aiTimeout);
            }
          }

          // ── 13. AI failure tracking & Fallback reply selection ──────────
          const finalReply = reply ?? FALLBACK_MESSAGE;
          const isFallback = !reply;

          if (isFallback) {
            console.error(`[AutoReply] AI failed all attempts (${lastAiError}) — fallback triggered | ${logCtx}`);
            
            // Trip circuit breaker on repeated failures
            aiFailureCount++;
            if (aiFailureCount >= MAX_AI_FAILURES) {
              aiCooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
              console.error(`[AutoReply] AI Circuit Breaker TRIPPED due to ${aiFailureCount} errors. Cooldown active.`);
            }
          } else {
            // Reset counter on successful reply
            aiFailureCount = 0;
          }

          // ── 13b. Brochure attachment detection ──────────────────────────
          // If the reply references a brochure file, ensure URL is in the
          // message text AND attach it as a Fonnte file so WhatsApp shows
          // it as a clickable PDF document.
          let attachUrl: string | undefined;
          let attachName: string | undefined;
          let replyWithLinks = finalReply;
          if (!isFallback && brosurFiles.length > 0) {
            for (const f of brosurFiles) {
              const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
              const lowered = replyWithLinks.toLowerCase();
              const mentioned =
                lowered.includes(f.name.toLowerCase()) ||
                lowered.includes(baseName.toLowerCase());
              if (!mentioned) continue;
              if (!replyWithLinks.includes(f.url)) {
                replyWithLinks += `\n${f.url}`;
              }
              if (!attachUrl) {
                attachUrl = f.url;
                attachName = f.name;
              }
            }
          }

          // ── 14. Outbound Idempotency Check ──────────────────────────────
          const replyHash = hashString(replyWithLinks);
          const outboundKey = `out:${customerPhone}:${replyHash}`;
          const lastSentTime = outboundDedup.get(outboundKey);

          if (lastSentTime && (Date.now() - lastSentTime < OUTBOUND_DEDUP_TTL_MS)) {
            console.warn(`[AutoReply] Outbound duplicate detected for ${customerPhone} — skipping Fonnte send | ${logCtx}`);
            return new Response("OK", { status: 200 });
          }

          // Lock message in idempotency cache
          outboundDedup.set(outboundKey, Date.now());

          // ── 15. Send reply via WhatsApp ─────────────────────────────────
          const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
            c.fonnte_token, customerPhone, replyWithLinks, attachUrl, attachName,
          );
          if (attachUrl) {
            console.log(`[AutoReply] attached brochure ${attachName} | ${logCtx}`);
          }

          if (!sent) {
            console.error(`[AutoReply] send failed: ${sendErr} | ${logCtx}`);
            outboundDedup.delete(outboundKey); // Clear lock on failure
            return new Response("OK", { status: 200 });
          }

          // ── 16. Persist outbound message ────────────────────────────────
          const agentKey   = orchResult?.agentKey ?? "front-office";
          const agentLabel = deriveAgentLabelFromKey(agentKey);

          await saveOutboundMessage(supabasePublic, {
            threadId: c.thread_id,
            body:     replyWithLinks,
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

        // Token protection validation for debug parameters
        const tokenParam   = url.searchParams.get("token");
        const authHeader   = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
        const webhookToken = process.env.FONNTE_WEBHOOK_TOKEN;
        const isAuthorized = webhookToken && (tokenParam === webhookToken || authHeader === webhookToken);

        if (url.searchParams.get("debug") === "1" || url.searchParams.get("test_reply") === "1") {
          if (!isAuthorized) {
            console.warn("[Webhook debug] Unauthorized access attempt blocked");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }
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
                  .select("id, name, base_rate, capacity, bed_type, description, amenities")
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

                  const rollingMessages = (c.messages ?? []).slice(-20);

                  const t0 = Date.now();
                  const orchResult = await runMultiAgentOrchestration({
                    phone:     testPhone,
                    messages:  rollingMessages,
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
                      origin:         url.origin,
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

        return new Response("Webhook is active (v5 — production safe)", { status: 200 });
      },
    },
  },
});
