```ts
/**
 * /api/fonnte — WhatsApp Webhook Endpoint (v5 — Conversation Lock + True Timeout)
 *
 * Improvements:
 * - True AbortController support
 * - Parallel DB loading
 * - Conversation lock (anti burst-race)
 * - Lightweight debounce aggregation
 * - Better context trimming
 * - Removed dead code
 * - Safer AI orchestration flow
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  supabasePublic,
  supabaseAdmin,
} from "@/integrations/supabase/client.server";

// ── Webhook ────────────────────────────────────────────────────────────────
import { verifyFonnteToken } from "@/webhook/verifier";
import { parseFonnteBody } from "@/webhook/parser";
import { isDuplicate, buildDedupKey } from "@/webhook/deduplicator";
import { classifyMessageIntent } from "@/webhook/intent-classifier";

// ── Repository ─────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
} from "@/repositories/message.repository";

// ── Services ───────────────────────────────────────────────────────────────
import { sendWhatsAppMessage } from "@/services/whatsapp.service";

// ── AI ─────────────────────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
} from "@/ai/multi-agent-orchestrator";

import { todayWIB } from "@/lib/date";

// ───────────────────────────────────────────────────────────────────────────

const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

const AI_TIMEOUT_MS = 22_000;
const LOCK_TTL_MS = 8_000;
const DEBOUNCE_MS = 1800;
const MAX_CONTEXT_MESSAGES = 15;

// ───────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

// ───────────────────────────────────────────────────────────────────────────
// In-memory conversation locks
// NOTE:
// Production scaling sebaiknya pindah ke Redis / Upstash
// ───────────────────────────────────────────────────────────────────────────

const conversationLocks = new Map<string, number>();

function acquireConversationLock(phone: string): boolean {
  const now = Date.now();
  const existing = conversationLocks.get(phone);

  if (existing && existing > now) {
    return false;
  }

  conversationLocks.set(phone, now + LOCK_TTL_MS);
  return true;
}

function releaseConversationLock(phone: string) {
  conversationLocks.delete(phone);
}

// ───────────────────────────────────────────────────────────────────────────

function trimMessages(
  messages: Array<{ direction: string; body: string }>
) {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

function newWorkerId(): string {
  return `w-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ───────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const workerId = newWorkerId();

        // ── 1. Verify token ───────────────────────────────────────────────
        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch");
        }

        // ── 2. Parse body ────────────────────────────────────────────────
        const event = await parseFonnteBody(request);

        if (!event) {
          return new Response("OK", { status: 200 });
        }

        const {
          sender,
          message,
          name,
          fonnteId,
          isOutgoing,
        } = event;

        const logCtx = `phone=${sender.slice(-6)} worker=${workerId}`;

        // ── 3. Skip outgoing ─────────────────────────────────────────────
        if (isOutgoing) {
          return new Response("OK", { status: 200 });
        }

        // ── 4. Dedup ─────────────────────────────────────────────────────
        const dedupKey = buildDedupKey(
          fonnteId,
          sender,
          message
        );

        if (isDuplicate(dedupKey)) {
          console.log(`[Webhook] duplicate | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 5. Conversation lock ────────────────────────────────────────
        const acquired = acquireConversationLock(sender);

        if (!acquired) {
          console.log(
            `[Webhook] conversation locked | ${logCtx}`
          );

          return new Response("OK", { status: 200 });
        }

        try {
          // ── 6. Save inbound ───────────────────────────────────────────
          const { messageId, error: saveErr } =
            await saveInboundMessage(
              supabasePublic,
              {
                phone: sender,
                name,
                body: message,
              }
            );

          if (saveErr) {
            console.error(
              `[Webhook] saveInbound failed: ${saveErr.message}`
            );

            return new Response("Error", { status: 500 });
          }

          // ── Intent metadata (non-blocking) ────────────────────────────
          if (messageId) {
            void saveMessageMetadata(supabasePublic, {
              messageId,
              metadata: {
                intent_label:
                  classifyMessageIntent(message),
              },
            }).catch((e) =>
              console.warn("[Webhook] intent error:", e)
            );
          }

          // ── 7. Debounce window ────────────────────────────────────────
          await sleep(DEBOUNCE_MS);

          // ── 8. Load autoreply context ─────────────────────────────────
          const { data: ctx, error: ctxErr } =
            await (supabasePublic as any).rpc(
              "get_autoreply_context",
              {
                p_phone: sender,
              }
            );

          if (ctxErr || !ctx) {
            console.error(
              `[AutoReply] context error | ${logCtx}`
            );

            return new Response("OK", { status: 200 });
          }

          const c = ctx as {
            thread_id: string;
            auto_reply_enabled: boolean;
            fonnte_token: string;
            messages: Array<{
              direction: string;
              body: string;
            }>;
          };

          if (!c.auto_reply_enabled) {
            return new Response("OK", {
              status: 200,
            });
          }

          // ── 9. Parallel load ──────────────────────────────────────────
          const [propRes, roomRes] = await Promise.all([
            (supabasePublic as any)
              .from("properties")
              .select("*")
              .limit(1)
              .maybeSingle(),

            (supabasePublic as any)
              .from("room_types")
              .select(`
                id,
                name,
                base_rate,
                capacity,
                bed_type,
                description,
                amenities
              `)
              .order("base_rate"),
          ]);

          const prop = propRes.data ?? {};
          const rooms = roomRes.data ?? [];

          // ── 10. AI Credentials ────────────────────────────────────────
          const explicitKey = (
            prop.ai_api_key as string | undefined
          )?.trim();

          const lovableKey =
            process.env.LOVABLE_API_KEY?.trim();

          const useLovable =
            !explicitKey && !!lovableKey;

          const apiKey =
            explicitKey || lovableKey;

          if (!apiKey) {
            console.error(
              `[AutoReply] no AI key | ${logCtx}`
            );

            await sendWhatsAppMessage(
              c.fonnte_token,
              sender,
              FALLBACK_MESSAGE
            );

            return new Response("OK", {
              status: 200,
            });
          }

          const baseUrl = useLovable
            ? "https://ai.gateway.lovable.dev/v1"
            : (
                (
                  prop.ai_base_url as
                    | string
                    | undefined
                ) ||
                "https://api.openai.com/v1"
              )
                .trim()
                .replace(/\/+$/, "");

          const model = useLovable
            ? "google/gemini-2.5-flash"
            : (
                prop.ai_model as
                  | string
                  | undefined
              ) || "gpt-4o-mini";

          // ── 11. Context trim ──────────────────────────────────────────
          const trimmedMessages = trimMessages(
            c.messages
          );

          // ── 12. True timeout AI ───────────────────────────────────────
          const controller = new AbortController();

          const timeout = setTimeout(() => {
            controller.abort();
          }, AI_TIMEOUT_MS);

          let orchResult: Awaited<
            ReturnType<
              typeof runMultiAgentOrchestration
            >
          > | null = null;

          try {
            orchResult =
              await runMultiAgentOrchestration({
                phone: sender,

                messages: trimmedMessages,

                signal: controller.signal,

                agentCtx: {
                  property: prop,
                  rooms,
                  sopText: "",
                  today: todayWIB(),
                  lastMessage: message,
                },

                toolCtx: {
                  supabasePublic:
                    supabasePublic as any,

                  supabaseAdmin:
                    supabaseAdmin as any,

                  rooms,
                  property: prop,
                  today: todayWIB(),
                },

                llmConfig: {
                  apiKey,
                  baseUrl,
                  model,
                },
              });
          } finally {
            clearTimeout(timeout);
          }

          // ── 13. Final reply ───────────────────────────────────────────
          const finalReply =
            orchResult?.reply ||
            FALLBACK_MESSAGE;

          const { ok: sent } =
            await sendWhatsAppMessage(
              c.fonnte_token,
              sender,
              finalReply
            );

          if (!sent) {
            console.error(
              `[AutoReply] send failed | ${logCtx}`
            );

            return new Response("OK", {
              status: 200,
            });
          }

          // ── 14. Persist outbound ──────────────────────────────────────
          const agentKey =
            orchResult?.agentKey ||
            "front-office";

          const agentLabel =
            deriveAgentLabelFromKey(agentKey);

          await saveOutboundMessage(
            supabasePublic,
            {
              threadId: c.thread_id,

              body: finalReply,

              metadata: {
                agent: agentLabel,

                tools_used:
                  orchResult?.toolsUsed ?? [],

                agent_key: agentKey,

                intent:
                  orchResult?.intent,

                routing_confidence:
                  orchResult?.routingConfidence,

                escalated:
                  orchResult?.escalated,

                is_fallback:
                  !orchResult?.reply,
              },
            }
          );

          void updateThreadAutoReplyMeta(
            supabasePublic,
            {
              threadId: c.thread_id,

              toolsUsed:
                orchResult?.toolsUsed ?? [],
            }
          ).catch((e) =>
            console.warn(
              "[AutoReply] meta update error:",
              e
            )
          );

          console.log(
            `[AutoReply] ✓ replied | ${logCtx}`
          );

          return new Response("OK", {
            status: 200,
          });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : String(err);

          console.error(
            `[Webhook] fatal: ${msg} | ${logCtx}`
          );

          return new Response("OK", {
            status: 200,
          });
        } finally {
          releaseConversationLock(sender);
        }
      },

      // ────────────────────────────────────────────────────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);

        const challenge =
          url.searchParams.get("challenge");

        if (
          challenge &&
          verifyFonnteToken(request)
        ) {
          return new Response(challenge, {
            status: 200,
          });
        }

        return new Response(
          "Webhook active (v5)",
          {
            status: 200,
          }
        );
      },
    },
  },
});
```
