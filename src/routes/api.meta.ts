/**
 * /api/meta — Official WhatsApp Cloud API Webhook Endpoint
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
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

const FALLBACK_MESSAGE = "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";
const AI_TIMEOUT_MS = 22_000;

function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

        const verifyToken = process.env.META_VERIFY_TOKEN || "pomah_rahasia_2026";

        if (mode === "subscribe" && token === verifyToken) {
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
        let body: any;
        
        try {
          body = await request.json();
        } catch {
          return new Response("OK", { status: 200 });
        }

        // Meta wraps webhook events inside 'entry' array
        if (body.object !== "whatsapp_business_account" || !body.entry) {
          return new Response("OK", { status: 200 });
        }

        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            const value = change.value;

            // Handle message status updates (sent, delivered, read)
            if (value.statuses) {
              // We could log statuses here in the future
              continue;
            }

            // Handle incoming messages
            if (value.messages && value.messages.length > 0) {
              const msg = value.messages[0];
              const contact = value.contacts?.[0];
              
              const customerPhone = msg.from; // Sender's phone number
              const name = contact?.profile?.name || customerPhone;
              const messageId = msg.id;
              
              // Only handle text messages for now (MVP)
              if (msg.type !== "text") {
                console.log(`[Meta Webhook] Ignoring non-text message type: ${msg.type}`);
                continue;
              }
              
              const messageText = msg.text?.body;
              if (!messageText) continue;

              const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;
              console.log("[Meta Webhook]", { customerPhone, msg: messageText.slice(0, 60) });

              // ── 1. Save inbound message ───────────────────────────────────────
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
                messages: Array<{ direction: string; body: string }>;
              };

              if (!c.auto_reply_enabled) {
                console.log(`[Meta Webhook] auto_reply_enabled=false — skipping | ${logCtx}`);
                continue;
              }

              const accessToken = process.env.META_ACCESS_TOKEN;
              const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

              if (!accessToken || !phoneNumberId) {
                console.error(`[Meta Webhook] META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not configured | ${logCtx}`);
                continue;
              }

              // ── 3. Run AI Orchestration ───────────────────────────────────────
              const DEBOUNCE_MS = 2000;
              await sleep(DEBOUNCE_MS);

              // Check if a newer message superseded this handler
              const { data: latestInbound } = await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .select("id")
                .eq("thread_id", c.thread_id)
                .eq("direction", "in")
                .order("sent_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (latestInbound && latestInbound.id !== dbMsgId) {
                console.log(`[Meta Webhook] superseded by newer message — aborting execution | ${logCtx}`);
                continue;
              }

              try {
                // Fetch context data
                const { data: prop } = await (supabasePublic as any).from("properties").select("*").limit(1).maybeSingle();
                const { data: rooms } = await (supabasePublic as any).from("room_types").select("*").order("base_rate");
                const p = (prop ?? {}) as Record<string, unknown>;

                const aiCfgRaw = p.ai_lab_config as Record<string, unknown> | undefined;
                let sopText = ""; // Simplified SOP fetch for brevity in MVP
                let brosurFiles: any[] = [];
                
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
                const controller = new AbortController();

                const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

                const orchResult = await runMultiAgentOrchestration({
                  phone: customerPhone,
                  messages: rollingMessages,
                  agentCtx: { property: p as any, rooms: rooms as any[], sopText, brosurFiles, today: todayWIB(), lastMessage: messageText },
                  toolCtx: { supabasePublic: supabasePublic as any, supabaseAdmin: supabaseAdmin as any, rooms: rooms as any[], property: p as any, today: todayWIB(), origin: new URL(request.url).origin },
                  llmConfig: { apiKey, baseUrl, model },
                  signal: controller.signal,
                });

                clearTimeout(aiTimeout);

                const finalReply = orchResult?.reply ?? FALLBACK_MESSAGE;
                const isFallback = !orchResult?.reply;

                // ── 4. Send Reply via Meta ───────────────────────────────────────
                const { ok: sent, error: sendErr } = await sendWhatsAppMetaMessage(
                  accessToken,
                  phoneNumberId,
                  customerPhone,
                  finalReply
                );

                if (!sent) {
                  console.error(`[Meta Webhook] Send failed: ${sendErr} | ${logCtx}`);
                  continue;
                }

                // ── 5. Save Outbound Message ─────────────────────────────────────
                const agentKey = orchResult?.agentKey ?? "front-office";
                await saveOutboundMessage(supabasePublic, {
                  threadId: c.thread_id,
                  body: finalReply,
                  metadata: {
                    agent: deriveAgentLabelFromKey(agentKey),
                    tools_used: orchResult?.toolsUsed ?? [],
                    agent_key: agentKey,
                    intent: orchResult?.intent,
                    is_fallback: isFallback,
                  } as any,
                });

                console.log(`[Meta Webhook] ✓ replied | fallback=${isFallback} | ${logCtx}`);
              } catch (err) {
                console.error(`[Meta Webhook] unexpected crash: ${err} | ${logCtx}`);
              }
            }
          }
        }

        // Meta expects a 200 OK response rapidly to acknowledge receipt
        return new Response("OK", { status: 200 });
      },
    },
  },
});
