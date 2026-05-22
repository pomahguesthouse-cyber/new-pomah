/**
 * /api/meta — Official WhatsApp Cloud API Webhook Endpoint (Full Brain Version)
 *
 * Implements high-reliability features:
 *   1.  Proper AbortController propagation for LLM timeouts
 *   2.  Rolling conversation context window limit (last 20 messages)
 *   3.  Graceful, in-memory TTL caching for SOP documents
 *   4.  Outbound message idempotency filtering (preventing duplicate sends)
 *   5.  AI Gateway circuit breaker and automatic cooldown fallback
 *   6.  Brochure attachment extraction and sending
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
} from "@/repositories/message.repository";

// ── Services ───────────────────────────────────────────────────────────────────
import { sendWhatsAppMetaMessage } from "@/services/meta.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
} from "@/ai/multi-agent-orchestrator";
import { classifyMessageIntent } from "@/webhook/intent-classifier";
import { todayWIB } from "@/lib/date";

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_MESSAGE = "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";
const AI_TIMEOUT_MS = 7_000; // Dikurangi menjadi 7 detik agar tidak dibunuh oleh Vercel 10s limit

// ─── Global Cache & Fault Tolerance State ─────────────────────────────────────

interface SopCache {
  docs: any[];
  fetchedAt: number;
}

let globalSopCache: SopCache | null = null;
const SOP_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

function isBrosurDoc(d: Record<string, unknown>): boolean {
  if ((d.doc_category as string) === "brosur") return true;
  const fp = (d.file_path as string | null) ?? "";
  return fp.startsWith("brosur/");
}

let aiFailureCount = 0;
let aiCooldownUntil = 0;
const MAX_AI_FAILURES = 5;
const COOLDOWN_DURATION_MS = 60 * 1000; // 1 minute cooldown

const outboundDedup = new Map<string, number>();
const OUTBOUND_DEDUP_TTL_MS = 15 * 1000;

function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

async function sendFallbackAndSave(
  accessToken: string,
  phoneNumberId: string,
  phone: string,
  threadId: string,
  logCtx: string
): Promise<void> {
  const { ok: sent, error: sendErr } = await sendWhatsAppMetaMessage(
    accessToken,
    phoneNumberId,
    phone,
    FALLBACK_MESSAGE
  );
  
  if (!sent) {
    console.error(`[Meta Webhook] Fallback send failed: ${sendErr} | ${logCtx}`);
    return;
  }
  
  await saveOutboundMessage(supabasePublic, {
    threadId,
    body: FALLBACK_MESSAGE,
    metadata: {
      agent: "Front Office Agent",
      tools_used: [],
      agent_key: "front-office",
      is_fallback: true,
    } as any,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/meta")({
  server: {
    handlers: {
      // ══════════════════════════════════════════════════════════════════════
      //  GET — Webhook verification from Meta Dashboard
      // ══════════════════════════════════════════════════════════════════════
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        // Dynamically fetch the expected verification token from the database
        const { data: prop } = await (supabaseAdmin as any).from("properties").select("meta_verify_token").limit(1).maybeSingle();
        const expectedToken = prop?.meta_verify_token || process.env.META_VERIFY_TOKEN || "pomah_rahasia_2026";

        if (mode === "subscribe" && token === expectedToken) {
          console.log("[Meta Webhook] Verification successful");
          return new Response(challenge, { status: 200 });
        } else {
          console.error("[Meta Webhook] Verification failed");
          return new Response("Forbidden", { status: 403 });
        }
      },

      // ══════════════════════════════════════════════════════════════════════
      //  POST — Incoming messages and statuses from WhatsApp
      // ══════════════════════════════════════════════════════════════════════
      POST: async ({ request }) => {
        const workerId = newWorkerId();
        const origin = new URL(request.url).origin;
        let body: any;
        
        try {
          body = await request.json();
        } catch {
          return new Response("OK", { status: 200 });
        }

        if (body.object !== "whatsapp_business_account" || !body.entry) {
          return new Response("OK", { status: 200 });
        }

        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            const value = change.value;

            if (value.statuses) {
              continue; // Status updates handled here later if needed
            }

            if (value.messages && value.messages.length > 0) {
              const msg = value.messages[0];
              const contact = value.contacts?.[0];
              
              const customerPhone = msg.from;
              const name = contact?.profile?.name || customerPhone;
              const messageId = msg.id;
              
              if (msg.type !== "text") {
                console.log(`[Meta Webhook] Ignoring non-text message type: ${msg.type}`);
                continue;
              }
              
              const messageText = msg.text?.body;
              if (!messageText) continue;

              const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;
              
              // ── 1. Save inbound message ───────────────────────────────────────
              // Note: using messageId as external_id (meta_message_id) mapping
              const { messageId: dbMsgId, error: saveErr } = await saveInboundMessage(
                supabasePublic,
                { phone: customerPhone, name, body: messageText },
              );
              
              if (saveErr || !dbMsgId) {
                console.error(`[Meta Webhook] saveInbound failed: ${saveErr?.message} | ${logCtx}`);
                return new Response("Error", { status: 500 });
              }

              // Intent badge
              void saveMessageMetadata(supabasePublic, {
                messageId: dbMsgId,
                metadata: { intent_label: classifyMessageIntent(messageText) },
              }).catch((e) => console.warn("[Meta Webhook] intent badge error:", e));

              // ── 2. Load autoreply context ─────────────────────────────────────
              const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
                "get_autoreply_context",
                { p_phone: customerPhone },
              );

              if (ctxErr || !ctx) {
                console.warn(`[Meta Webhook] get_autoreply_context failed: ${ctxErr?.message} | ${logCtx}`);
                continue;
              }

              const c = ctx as {
                thread_id: string;
                auto_reply_enabled: boolean;
                meta_access_token: string | null;
                meta_phone_number_id: string | null;
                messages: Array<{ direction: string; body: string }>;
              };

              if (!c.auto_reply_enabled) {
                console.log(`[Meta Webhook] auto_reply_enabled=false — skipping | ${logCtx}`);
                continue;
              }

              const accessToken = c.meta_access_token;
              const phoneNumberId = c.meta_phone_number_id;

              if (!accessToken || !phoneNumberId) {
                console.error(`[Meta Webhook] META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not configured in database | ${logCtx}`);
                continue;
              }

              // Check circuit breaker cooldown
              if (Date.now() < aiCooldownUntil) {
                console.warn(`[Meta Webhook] AI Circuit Breaker ACTIVE, skipping orchestration | ${logCtx}`);
                await sendFallbackAndSave(accessToken, phoneNumberId, customerPhone, c.thread_id, logCtx);
                continue;
              }

              // ── 3. Debounce ───────────────────────────────────────────────────
              const DEBOUNCE_MS = 250; // Dikurangi dari 2500ms agar Vercel Hobby tidak timeout (10s limit)
              await sleep(DEBOUNCE_MS);

              const { data: latestInbound } = await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .select("id")
                .eq("thread_id", c.thread_id)
                .eq("direction", "in")
                .order("sent_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (latestInbound && latestInbound.id !== dbMsgId) {
                console.log(`[Meta Webhook] superseded by newer message — aborting | ${logCtx}`);
                continue;
              }

              try {
                // Fetch property and rooms
                const { data: prop } = await (supabasePublic as any).from("properties").select("*").limit(1).maybeSingle();
                const { data: rooms } = await (supabasePublic as any).from("room_types").select("*").order("base_rate");
                const p = (prop ?? {}) as Record<string, unknown>;

                // ── 4. Load SOP Documents (Cached) ──────────────────────────────
                const aiCfgRaw = p.ai_lab_config as Record<string, unknown> | undefined;
                const sopEnabled = (aiCfgRaw?.tools as any)?.["sop-knowledge"]?.enabled ?? true;
                let sopText = "";
                let brosurFiles: { name: string; url: string }[] = [];
                const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");

                if (sopEnabled) {
                  let sopDocs: any[] = [];
                  const nowMs = Date.now();
                  if (globalSopCache && (nowMs - globalSopCache.fetchedAt < SOP_CACHE_TTL_MS)) {
                    sopDocs = globalSopCache.docs;
                  } else {
                    try {
                      const { data: fetchedDocs, error: fetchErr } = await (supabaseAdmin as any)
                        .from("sop_documents")
                        .select("name, content, source_url, file_path, doc_category")
                        .order("created_at", { ascending: true })
                        .limit(40);
                      if (!fetchErr) {
                        sopDocs = fetchedDocs ?? [];
                        globalSopCache = { docs: sopDocs, fetchedAt: nowMs };
                      }
                    } catch (e) {
                      if (globalSopCache) sopDocs = globalSopCache.docs;
                    }
                  }

                  const parts: string[] = [];
                  for (const d of sopDocs) {
                    if (isBrosurDoc(d)) {
                      const fp = (d.file_path as string | undefined)?.trim();
                      if (fp) {
                        brosurFiles.push({
                          name: d.name as string,
                          url: `${supabaseUrl}/storage/v1/object/public/sop-documents/${fp}`,
                        });
                      }
                      continue;
                    }
                    const content = (d.content as string | undefined)?.trim();
                    const url = (d.source_url as string | undefined)?.trim();
                    if (!content && !url) continue;
                    const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
                    parts.push(content ? `${head}\n${content}` : head);
                  }
                  sopText = parts.join("\n\n").slice(0, 8000);
                }

                // ── 5. Setup LLM config ─────────────────────────────────────────
                const lovableKey = process.env.LOVABLE_API_KEY?.trim();
                const explicitKey = (p.ai_api_key as string | undefined)?.trim();
                const apiKey = explicitKey || lovableKey;

                if (!apiKey) {
                  await sendFallbackAndSave(accessToken, phoneNumberId, customerPhone, c.thread_id, logCtx);
                  continue;
                }

                const baseUrl = lovableKey && !explicitKey ? "https://ai.gateway.lovable.dev/v1" : ((p.ai_base_url as string) || "https://api.openai.com/v1");
                const model = p.ai_model as string || "gpt-4o-mini";
                const rollingMessages = (c.messages ?? []).slice(-20);
                
                // ── 6. Run AI Orchestration with Retries ────────────────────────
                const MAX_AI_RETRIES = 3;
                let reply: string | null = null;
                let orchResult: any = null;

                for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
                  if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));

                  const controller = new AbortController();
                  const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

                  try {
                    orchResult = await runMultiAgentOrchestration({
                      phone: customerPhone,
                      messages: rollingMessages,
                      agentCtx: { property: p as any, rooms: rooms as any[], sopText, brosurFiles, today: todayWIB(), lastMessage: messageText },
                      toolCtx: { supabasePublic: supabasePublic as any, supabaseAdmin: supabaseAdmin as any, rooms: rooms as any[], property: p as any, today: todayWIB(), origin },
                      llmConfig: { apiKey, baseUrl, model },
                      signal: controller.signal,
                    });

                    if (orchResult?.reply) {
                      reply = orchResult.reply;
                      break;
                    }
                  } catch (e) {
                    console.error(`[Meta Webhook] AI attempt ${attempt} failed: ${e} | ${logCtx}`);
                  } finally {
                    clearTimeout(aiTimeout);
                  }
                }

                // ── 7. Handle Fallback & Circuit Breaker ────────────────────────
                const isFallback = !reply;
                if (isFallback) {
                  aiFailureCount++;
                  if (aiFailureCount >= MAX_AI_FAILURES) {
                    aiCooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
                  }
                } else {
                  aiFailureCount = 0;
                }
                const finalReply = reply ?? FALLBACK_MESSAGE;

                // ── 8. Process Attachments ──────────────────────────────────────
                let attachUrl: string | undefined;
                let attachName: string | undefined;
                let replyWithLinks = finalReply;

                if (!isFallback && brosurFiles.length > 0) {
                  for (const f of brosurFiles) {
                    const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
                    const lowered = replyWithLinks.toLowerCase();
                    if (lowered.includes(f.name.toLowerCase()) || lowered.includes(baseName.toLowerCase())) {
                      if (!replyWithLinks.includes(f.url)) {
                        replyWithLinks += `\n${f.url}`;
                      }
                      if (!attachUrl) {
                        attachUrl = f.url;
                        attachName = f.name;
                      }
                    }
                  }
                }

                // ── 9. Outbound Idempotency ─────────────────────────────────────
                const replyHash = hashString(replyWithLinks);
                const outboundKey = `out:${customerPhone}:${replyHash}`;
                const lastSentTime = outboundDedup.get(outboundKey);

                if (lastSentTime && (Date.now() - lastSentTime < OUTBOUND_DEDUP_TTL_MS)) {
                  console.warn(`[Meta Webhook] Duplicate prevented for ${customerPhone} | ${logCtx}`);
                  continue;
                }

                // ── 10. Send Reply via Meta ──────────────────────────────────────
                const { ok: sent, error: sendErr } = await sendWhatsAppMetaMessage(
                  accessToken,
                  phoneNumberId,
                  customerPhone,
                  replyWithLinks,
                  attachUrl,
                  attachName
                );

                if (!sent) {
                  console.error(`[Meta Webhook] Send failed: ${sendErr} | ${logCtx}`);
                  continue;
                }

                outboundDedup.set(outboundKey, Date.now());

                // ── 11. Save Outbound Message ──────────────────────────────────
                const agentKey = orchResult?.agentKey ?? "front-office";
                await saveOutboundMessage(supabasePublic, {
                  threadId: c.thread_id,
                  body: replyWithLinks,
                  metadata: {
                    agent: deriveAgentLabelFromKey(agentKey),
                    tools_used: orchResult?.toolsUsed ?? [],
                    agent_key: agentKey,
                    intent: orchResult?.intent,
                    is_fallback: isFallback,
                    attach_url: attachUrl,
                  } as any,
                });

                console.log(`[Meta Webhook] ✓ replied | fallback=${isFallback} | ${logCtx}`);
              } catch (err) {
                console.error(`[Meta Webhook] unexpected crash: ${err} | ${logCtx}`);
              }
            }
          }
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});
