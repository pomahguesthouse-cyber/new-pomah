/**
 * /api/fonnte — WhatsApp Webhook Endpoint
 *
 * Production path:
 *   1. Accept and persist incoming Fonnte webhook payloads.
 *   2. Return 200 quickly.
 *   3. Enqueue inbound messages to `wa_conversation_queue`.
 *   4. Let queue workers run AI/autoreply asynchronously.
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyFonnteToken } from "@/webhook/verifier";
import { parseFonnteBody } from "@/webhook/parser";
import { isDuplicate, isDuplicateBody, buildDedupKey } from "@/webhook/deduplicator";
import { classifyMessageIntent } from "@/webhook/intent-classifier";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
} from "@/repositories/message.repository";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import { runMultiAgentOrchestration } from "@/ai/multi-agent-orchestrator";
import { todayWIB } from "@/lib/date";

const SESSION_GAP_MS = 15 * 60 * 1000;

type ThreadRow = {
  id: string;
  created_at?: string | null;
};

type SopDebugContext = {
  sopText: string;
  brosurFiles: { name: string; url: string }[];
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function getAuthorized(request: Request, url: URL): boolean {
  const tokenParam = url.searchParams.get("token");
  const authHeader = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const webhookToken = process.env.FONNTE_WEBHOOK_TOKEN;
  return !!webhookToken && (tokenParam === webhookToken || authHeader === webhookToken);
}

async function getWaitUntilRunner(): Promise<(task: Promise<void>) => void> {
  const { getWaitUntil } = await import("@/lib/cf-context");
  const waitUntil = getWaitUntil();
  return (task: Promise<void>) => {
    if (waitUntil) waitUntil(task);
  };
}

function scheduleQueueNudge(
  runBackground: (task: Promise<void>) => void,
  origin: string,
  waitMs: number,
  logCtx: string,
) {
  const nudgeDelayMs = Math.max(500, Math.min(waitMs + 500, 15_000));
  runBackground((async () => {
    await sleep(nudgeDelayMs);
    try {
      const res = await fetch(`${origin}/api/queue-worker`, { method: "POST" });
      if (!res.ok) {
        console.warn(`[Webhook] queue nudge failed status=${res.status} | ${logCtx}`);
      }
    } catch (e) {
      console.warn(`[Webhook] queue nudge failed: ${e} | ${logCtx}`);
    }
  })());
}

function isBrosurLike(doc: any): boolean {
  const cat = String(doc?.doc_category ?? "").toLowerCase();
  const name = String(doc?.name ?? "").toLowerCase();
  const filePath = String(doc?.file_path ?? "").toLowerCase();
  return (
    cat === "brosur" ||
    cat === "brochure" ||
    name.includes("brosur") ||
    name.includes("brochure") ||
    filePath.includes("brosur") ||
    filePath.includes("brochure")
  );
}

async function loadSopDebugContext(): Promise<SopDebugContext> {
  const { data: docs } = await (supabaseAdmin as any)
    .from("sop_documents")
    .select("name, content, source_url, file_path, doc_category, storage_bucket")
    .order("created_at", { ascending: true })
    .limit(40);

  const supaUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const parts: string[] = [];
  const brosurFiles: { name: string; url: string }[] = [];

  for (const d of docs ?? []) {
    if (isBrosurLike(d)) {
      if (d.file_path) {
        const bucket = String(d.storage_bucket ?? "").trim() || "sop-documents";
        brosurFiles.push({
          name: d.name,
          url: `${supaUrl}/storage/v1/object/public/${bucket}/${d.file_path}`,
        });
      }
      continue;
    }

    const content = d.content?.trim();
    const sourceUrl = d.source_url?.trim();
    if (!content && !sourceUrl) continue;

    const head = sourceUrl ? `### ${d.name} (Tautan: ${sourceUrl})` : `### ${d.name}`;
    parts.push(content ? `${head}\n${content}` : head);
  }

  return {
    sopText: parts.join("\n\n").slice(0, 8000),
    brosurFiles,
  };
}

/**
 * Detect whether the current inbound message starts a new session by looking at
 * the previous message in the same thread, excluding the newly inserted message.
 * This is more accurate than `whatsapp_threads.last_message_at`, because the RPC
 * has already updated that field by the time webhook code continues.
 */
async function detectNewSession(params: {
  phone: string;
  messageId: string;
}): Promise<{ threadId: string | null; isNewThread: boolean; isNewSession: boolean }> {
  const { data: threadRow } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, created_at")
    .eq("phone", params.phone)
    .maybeSingle();

  const thread = threadRow as ThreadRow | null;
  if (!thread?.id) {
    return { threadId: null, isNewThread: false, isNewSession: false };
  }

  const { data: prevRows } = await (supabaseAdmin as any)
    .from("whatsapp_messages")
    .select("id, sent_at")
    .eq("thread_id", thread.id)
    .neq("id", params.messageId)
    .order("sent_at", { ascending: false })
    .limit(1);

  const previous = Array.isArray(prevRows) ? prevRows[0] : null;
  const isNewThread = !previous;

  if (!previous?.sent_at) {
    return { threadId: thread.id, isNewThread, isNewSession: true };
  }

  const gapMs = Date.now() - new Date(previous.sent_at).getTime();
  return {
    threadId: thread.id,
    isNewThread,
    isNewSession: gapMs > SESSION_GAP_MS,
  };
}

async function notifyNewSessionIfNeeded(input: {
  phone: string;
  guestName: string | null;
  firstMessage: string;
  messageId: string;
}): Promise<void> {
  const session = await detectNewSession({
    phone: input.phone,
    messageId: input.messageId,
  });

  if (!session.threadId || !session.isNewSession) return;

  const { notifyNewConversationSession } = await import("@/services/manager-notifier.service");
  await notifyNewConversationSession(supabaseAdmin as any, {
    phone: input.phone,
    guestName: input.guestName,
    firstMessage: input.firstMessage,
    isNewThread: session.isNewThread,
    threadId: session.threadId,
  });
}

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const workerId = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        const event = await parseFonnteBody(request);
        if (!event) return new Response("OK", { status: 200 });

        const { sender, message, name, fonnteId, isOutgoing, customerPhone, rawBody } = event;
        const attachmentUrl = event.attachmentUrl;
        const attachmentName = event.attachmentName;
        const attachmentMime = event.attachmentMime;
        const messageType = event.messageType;
        const displayMessage = message || (attachmentUrl ? `[Lampiran ${messageType ?? attachmentMime ?? "media"}]` : "");
        const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;

        console.log("[Webhook]", {
          sender,
          customerPhone,
          isOutgoing,
          hasAttachment: !!attachmentUrl,
          msg: displayMessage.slice(0, 60),
          rawBodyKeys: Object.keys(rawBody),
        });

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
                .insert({
                  phone: customerPhone,
                  display_name: name || customerPhone,
                  status: "open",
                  unread_count: 0,
                })
                .select("id")
                .single();
              threadId = newThread?.id;
            }

            if (threadId) {
              let existingMsg: { id: string } | null = null;
              if (fonnteId) {
                const byId = await (supabaseAdmin as any)
                  .from("whatsapp_messages")
                  .select("id")
                  .eq("fonnte_id", fonnteId)
                  .maybeSingle();
                existingMsg = byId.data ?? null;
              }

              if (!existingMsg) {
                const twoMinsAgo = new Date(Date.now() - 2 * 60000).toISOString();
                const byBody = await (supabaseAdmin as any)
                  .from("whatsapp_messages")
                  .select("id")
                  .eq("thread_id", threadId)
                  .eq("direction", "out")
                  .eq("body", displayMessage)
                  .gte("sent_at", twoMinsAgo)
                  .maybeSingle();
                existingMsg = byBody.data ?? null;
              }

              if (!existingMsg) {
                await (supabaseAdmin as any).rpc("save_outbound_whatsapp", {
                  p_thread_id: threadId,
                  p_body: displayMessage,
                  p_metadata: {
                    is_native_human: true,
                    source: "whatsapp_native",
                    attachment_url: attachmentUrl ?? null,
                    media_url: attachmentUrl ?? null,
                    file_name: attachmentName ?? null,
                    mime_type: attachmentMime ?? null,
                    media_type: messageType ?? null,
                    attachment: attachmentUrl
                      ? {
                          url: attachmentUrl,
                          file_name: attachmentName ?? null,
                          mime_type: attachmentMime ?? null,
                          type: messageType ?? null,
                        }
                      : null,
                  },
                  p_fonnte_id: fonnteId ?? null,
                });
              }
            }
          } catch (err) {
            console.error(`[Webhook] Error handling native outgoing message: ${err} | ${logCtx}`);
          }
          return new Response("OK", { status: 200 });
        }

        const dedupKey = buildDedupKey(fonnteId, sender, displayMessage);
        if (isDuplicate(dedupKey) || isDuplicateBody(sender, displayMessage)) {
          console.log(`[Webhook] duplicate | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const { messageId, duplicate, error: saveErr } = await saveInboundMessage(
          supabaseAdmin,
          { phone: customerPhone, name, body: displayMessage, fonnteId },
        );
        if (saveErr || !messageId) {
          console.error(`[Webhook] saveInbound failed: ${saveErr?.message ?? "no messageId"} | ${logCtx}`);
          return new Response("Error", { status: 500 });
        }
        if (duplicate) {
          console.log(`[Webhook] duplicate persisted inbound | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const runBackground = await getWaitUntilRunner();

        runBackground(saveMessageMetadata(supabaseAdmin, {
          messageId,
          metadata: {
            intent_label: classifyMessageIntent(displayMessage),
            attachment_url: attachmentUrl ?? null,
            media_url: attachmentUrl ?? null,
            file_name: attachmentName ?? null,
            mime_type: attachmentMime ?? null,
            media_type: messageType ?? null,
            fonnte_id: fonnteId ?? null,
            attachment: attachmentUrl
              ? {
                  url: attachmentUrl,
                  file_name: attachmentName ?? null,
                  mime_type: attachmentMime ?? null,
                  type: messageType ?? null,
                }
              : null,
          },
        }).catch((e) => console.warn("[Webhook] intent badge error:", e)));

        runBackground((async () => {
          try {
            const { notifyIncomingMessage } = await import("@/services/manager-notifier.service");
            await notifyIncomingMessage(supabaseAdmin as any, {
              phone: customerPhone,
              guestName: name || null,
              body: displayMessage,
              messageId,
              threadId: null,
              hasAttachment: !!attachmentUrl,
            });
          } catch (e) {
            console.warn("[Webhook] notifyIncomingMessage failed (non-fatal):", e);
          }
        })());

        runBackground((async () => {
          try {
            await notifyNewSessionIfNeeded({
              phone: customerPhone,
              guestName: name || null,
              firstMessage: displayMessage,
              messageId,
            });
          } catch (e) {
            console.warn("[Webhook] New session notif failed (non-fatal):", e);
          }
        })());

        // Gate OCR ke gambar SAJA. Sebelumnya semua attachment (PDF/video/
        // audio) ikut men-trigger Vision OCR — buang kredit & bikin log
        // pipeline finance kotor. Kalau MIME kosong, cek ekstensi URL.
        const isImageAttachment = (() => {
          if (!attachmentUrl) return false;
          const mime = (attachmentMime ?? "").toLowerCase();
          if (mime.startsWith("image/")) return true;
          if (mime && !mime.startsWith("image/")) return false;
          return /\.(jpe?g|png|webp|heic|heif|gif)(\?|$)/i.test(attachmentUrl);
        })();

        if (isImageAttachment && attachmentUrl) {
          // Tag intent metadata SEBELUM OCR jalan supaya routing-debug bisa
          // melihat pipeline payment_proof aktif meski OCR async selesai
          // belakangan (atau gagal).
          runBackground(saveMessageMetadata(supabaseAdmin, {
            messageId,
            metadata: {
              intent: "payment_proof",
              agent_key: "finance",
              tools_used: ["payment-proof-ocr"],
              routing_confidence: 1,
              fast_path: true,
              pipeline: "payment_proof_ocr",
            },
          }).catch((e) => console.warn("[Webhook] payment_proof intent tag error:", e)));

          runBackground((async () => {
            try {
              const { analyzePaymentProof } = await import("@/services/payment-proof.service");
              const ocrResult = await analyzePaymentProof(
                supabaseAdmin as any,
                attachmentUrl,
                customerPhone,
                messageId,
              );

              const { notifyPaymentProof } = await import("@/services/manager-notifier.service");
              await notifyPaymentProof(supabaseAdmin as any, {
                threadId: null,
                phone: customerPhone,
                guestName: name,
                imageUrl: attachmentUrl,
                messageId,
                ocrResult,
              });
            } catch (err) {
              console.warn("[Webhook] Payment proof OCR/notification gagal:", err);
            }
          })());
        } else if (attachmentUrl) {
          console.info(
            `[Webhook] Skip OCR non-image attachment (mime=${attachmentMime ?? "?"}, type=${messageType ?? "?"})`,
          );
        }


        const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
          "get_autoreply_context",
          { p_phone: customerPhone },
        );

        if (ctxErr || !ctx) {
          console.error(`[Webhook] context RPC error: ${ctxErr?.message ?? "no context"} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id: string;
          auto_reply_enabled: boolean;
          fonnte_token: string;
          smart_delay_config?: Record<string, unknown> | null;
        };

        let isManager = false;
        try {
          const { resolveManagerByPhone } = await import("@/services/wa-autoreply.service");
          isManager = !!(await resolveManagerByPhone(customerPhone));
        } catch (e) {
          console.warn(`[Webhook] resolveManagerByPhone failed (non-fatal): ${e} | ${logCtx}`);
        }

        if (!isManager && !c.auto_reply_enabled) {
          console.log(`[Webhook] auto_reply_enabled=false — skipping | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!c.fonnte_token) {
          console.error(`[Webhook] fonnte_token not configured | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        try {
          const { resolveQueueTiming, queueUpsert, queueCleanupZombies } = await import("@/services/queue.service");
          const { delayMs, maxWaitMs } = resolveQueueTiming(message, c.smart_delay_config as any);

          await queueCleanupZombies(supabaseAdmin);

          const entry = await queueUpsert(supabaseAdmin, {
            phone: customerPhone,
            threadId: c.thread_id,
            messageId,
            body: displayMessage,
            delayMs,
            maxWaitMs,
          });

          console.log(
            `[Webhook] Enqueued (entry=${entry?.entryId?.slice(0, 8) ?? "none"} delay=${delayMs}ms) | ${logCtx}`,
          );

          if (entry?.entryId) {
            scheduleQueueNudge(
              runBackground,
              new URL(request.url).origin,
              entry.sleepMs ?? delayMs,
              logCtx,
            );
          }
        } catch (e) {
          console.error(`[Webhook] enqueue error: ${e} | ${logCtx}`);
        }

        return new Response("OK", { status: 200 });
      },

      GET: async ({ request }) => {
        const url = new URL(request.url);

        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyFonnteToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        const wantsDebug = url.searchParams.get("debug") === "1";
        const wantsTestReply = url.searchParams.get("test_reply") === "1";
        if ((wantsDebug || wantsTestReply) && !getAuthorized(request, url)) {
          console.warn("[Webhook debug] Unauthorized access attempt blocked");
          return json({ error: "Unauthorized" }, 403);
        }

        if (wantsDebug) {
          const debugPhone = url.searchParams.get("phone") ?? "debug_test_000";
          const report: Record<string, unknown> = {
            env_token_set: !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set: !!process.env.SUPABASE_URL,
            env_supabase_key_set: !!process.env.SUPABASE_PUBLISHABLE_KEY,
            env_lovable_api_key_set: !!process.env.LOVABLE_API_KEY,
            debug_phone: debugPhone,
          };

          if (debugPhone === "debug_test_000") {
            const { error } = await saveInboundMessage(supabasePublic, {
              phone: "debug_test_000",
              name: "Debug Test",
              body: "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_receive_ok = !error;
            report.rpc_receive_error = error ? error.message : null;
          }

          try {
            const { data: ctx, error } = await (supabaseAdmin as any).rpc(
              "get_autoreply_context",
              { p_phone: debugPhone },
            );
            report.rpc_autoreply_ok = !error;
            report.rpc_autoreply_error = error ? (error as any).message : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set = !!(c.fonnte_token as string)?.length;
              report.message_count = Array.isArray(c.messages) ? c.messages.length : 0;
            }
          } catch (e) {
            report.rpc_autoreply_error = String(e);
          }

          try {
            const { data: queueItems, error: qErr } = await (supabaseAdmin as any)
              .from("wa_conversation_queue")
              .select("id, phone, status, message_count, attempt, lock_expires_at, process_after, created_at, completed_at, last_error")
              .order("created_at", { ascending: false })
              .limit(10);
            if (qErr) report.queue_error = qErr.message;
            else report.queue_items = queueItems;
          } catch (e) {
            report.queue_error = String(e);
          }

          try {
            const { data: lastMsgs, error: mErr } = await (supabaseAdmin as any)
              .from("whatsapp_messages")
              .select("id, direction, body, sent_at")
              .order("sent_at", { ascending: false })
              .limit(10);
            if (mErr) report.last_messages_error = mErr.message;
            else report.last_messages = lastMsgs;
          } catch (e) {
            report.last_messages_error = String(e);
          }

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
              report.llm_status = r.status;
              if (!r.ok) report.llm_error = await r.text();
            } catch (e) {
              report.llm_reachable = false;
              report.llm_error = String(e);
            }
          } else {
            report.llm_reachable = false;
            report.llm_error = "LOVABLE_API_KEY not set";
          }

          return json(report);
        }

        if (wantsTestReply) {
          const testPhone = url.searchParams.get("phone");
          if (!testPhone) return json({ error: "phone param required" }, 400);

          const result: Record<string, unknown> = { phone: testPhone };

          try {
            const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
              "get_autoreply_context",
              { p_phone: testPhone },
            );

            if (ctxErr || !ctx) {
              result.error = "get_autoreply_context failed";
              result.detail = (ctxErr as any)?.message ?? "null ctx";
              return json(result);
            }

            const c = ctx as {
              thread_id: string;
              auto_reply_enabled: boolean;
              fonnte_token: string;
              chat_summary?: string | null;
              chat_summary_json?: Record<string, unknown> | null;
              messages: Array<{ direction: string; body: string; sent_at?: string }>;
            };

            result.auto_reply_enabled = c.auto_reply_enabled;
            result.message_count = c.messages?.length ?? 0;
            result.last_messages = (c.messages ?? []).slice(-3).map((m) => ({
              direction: m.direction,
              body: m.body?.slice(0, 60),
            }));

            const { resolveManagerByPhone } = await import("@/services/wa-autoreply.service");
            const manager = await resolveManagerByPhone(testPhone);
            const isManager = !!manager;

            if (!isManager && !c.auto_reply_enabled) {
              result.skipped = "auto_reply_enabled is false";
              return json(result);
            }

            const { data: prop } = await (supabaseAdmin as any)
              .from("properties")
              .select("*")
              .limit(1)
              .maybeSingle();
            const p = (prop ?? {}) as Record<string, unknown>;

            const { data: rooms } = await (supabasePublic as any)
              .from("room_types")
              .select("id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate")
              .order("base_rate");
            const roomList = (rooms ?? []) as any[];

            const explicitKey = (p.ai_api_key as string | undefined)?.trim();
            const lovableKey = process.env.LOVABLE_API_KEY?.trim();
            const useLovable = !explicitKey && !!lovableKey;
            const apiKey = explicitKey || lovableKey;

            if (!apiKey) {
              result.error = "No AI key configured";
              return json(result);
            }

            const baseUrl = useLovable
              ? "https://ai.gateway.lovable.dev/v1"
              : String(p.ai_base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
            const cfgModel = (p.ai_model as string | undefined)?.trim();
            const model = useLovable
              ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
              : cfgModel || "gpt-4o-mini";

            let sessionStartIndex = 0;
            const msgs = c.messages ?? [];
            for (let i = msgs.length - 1; i > 0; i--) {
              const current = msgs[i];
              const prev = msgs[i - 1];
              if (current.sent_at && prev.sent_at) {
                const diffMs = new Date(current.sent_at).getTime() - new Date(prev.sent_at).getTime();
                if (diffMs > 5 * 60 * 1000) {
                  sessionStartIndex = i;
                  break;
                }
              }
            }
            const rollingMessages = msgs.slice(sessionStartIndex).slice(-20);

            const debugSop = url.searchParams.get("sop") === "1"
              ? await loadSopDebugContext()
              : { sopText: "", brosurFiles: [] };

            result.sop_len = debugSop.sopText.length;
            result.brosur_count = debugSop.brosurFiles.length;

            const t0 = Date.now();
            const orchResult = await runMultiAgentOrchestration({
              phone: testPhone,
              isManager,
              messages: rollingMessages,
              agentCtx: {
                property: p as any,
                rooms: roomList,
                sopText: debugSop.sopText,
                brosurFiles: debugSop.brosurFiles,
                today: todayWIB(),
                chatSummary: c.chat_summary || "",
                chatSummaryJson: c.chat_summary_json as any,
                managerName: manager?.name,
                mode: manager ? "managerial" : undefined,
              },
              toolCtx: {
                supabasePublic: supabasePublic as any,
                supabaseAdmin: supabaseAdmin as any,
                rooms: roomList,
                property: p as any,
                today: todayWIB(),
                origin: url.origin,
                llmConfig: { apiKey, baseUrl, model },
              },
              llmConfig: { apiKey, baseUrl, model },
            });

            result.elapsed_ms = Date.now() - t0;
            result.status = orchResult.status;
            result.reply = orchResult.reply;
            result.tools_used = orchResult.toolsUsed;
            result.agent_key = orchResult.agentKey;
            result.intent = orchResult.intent;
            result.routing_confidence = orchResult.routingConfidence;
            result.escalated = orchResult.escalated;
            result.reply_ok = !!orchResult.reply;
            if (orchResult.error) result.error = orchResult.error;

            if (url.searchParams.get("send") === "1" && orchResult.reply && c.fonnte_token) {
              const { ok, error: sendErr } = await sendWhatsAppMessage(
                c.fonnte_token,
                testPhone,
                orchResult.reply,
              );
              result.sent = ok;
              result.send_error = sendErr;
              if (ok && c.thread_id) {
                await saveOutboundMessage(supabaseAdmin, {
                  threadId: c.thread_id,
                  body: orchResult.reply,
                  metadata: { agent: "test_reply", is_test: true } as any,
                });
              }
            }
          } catch (e) {
            result.error = String(e);
          }

          return json(result);
        }

        return new Response("Webhook is active (queue-based)", { status: 200 });
      },
    },
  },
});
