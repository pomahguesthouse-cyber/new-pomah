/**
 * /api/wpp — WhatsApp Webhook Endpoint (WPPConnect)
 *
 * Production path:
 *   1. Accept and persist incoming Wpp webhook payloads.
 *   2. Return 200 quickly.
 *   3. Enqueue inbound messages to `wa_conversation_queue`.
 *   4. Let queue workers run AI/autoreply asynchronously.
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyWppToken } from "@/webhook/verifier";
import { parseWppWebhook } from "@/webhook/parser";
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
  const webhookToken = process.env.WPP_WEBHOOK_TOKEN;
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

export const wppWebhookPost = async ({ request }: { request: Request }): Promise<Response> => {
        const workerId = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (!verifyWppToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        const event = await parseWppWebhook(request);
        if (!event) return new Response("OK", { status: 200 });

        const { sender, message, name, wppId, isOutgoing, customerPhone, rawBody } = event;
        const attachmentUrl = event.attachmentUrl;
        const attachmentName = event.attachmentName;
        const attachmentMime = event.attachmentMime;
        const messageType = event.messageType;
        const isMediaMsg = !!attachmentUrl || (!!messageType && messageType.toLowerCase() !== "chat" && messageType.toLowerCase() !== "text") || !!attachmentMime;
        const displayMessage = message || (isMediaMsg ? `[Lampiran ${messageType ?? attachmentMime ?? "media"}]` : "");
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
            // GLOBAL dedup dulu SEBELUM sentuh thread. WPPConnect meng-echo
            // setiap pesan yang KITA kirim sendiri via API kembali ke webhook.
            // Kalau kita tidak dedupe global, echo bisa nyasar ke thread lain
            // (karena LID/PN device tidak sama dengan phone tamu di DB) dan
            // muncul sebagai "pesan berulang" di admin UI.
            if (wppId) {
              const { data: existingById } = await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .select("id")
                .eq("wpp_id", wppId)
                .maybeSingle();
              if (existingById) return new Response("OK", { status: 200 });
            }

            // Fallback body-dedup global (2 menit) — echo dari API-send kita
            // sendiri: body persis sama dengan yang baru saja app tulis via
            // save_outbound_whatsapp / autoreply pipeline.
            const twoMinsAgo = new Date(Date.now() - 2 * 60000).toISOString();
            const { data: existingByBody } = await (supabaseAdmin as any)
              .from("whatsapp_messages")
              .select("id")
              .eq("direction", "out")
              .eq("body", displayMessage)
              .gte("sent_at", twoMinsAgo)
              .limit(1)
              .maybeSingle();
            if (existingByBody) {
              // Ini echo dari pesan yang KITA kirim. Update wpp_id di record
              // kita bila belum ada, agar future dedup by wpp_id efektif.
              if (wppId) {
                await (supabaseAdmin as any)
                  .from("whatsapp_messages")
                  .update({ wpp_id: wppId })
                  .eq("id", existingByBody.id)
                  .is("wpp_id", null);
              }
              return new Response("OK", { status: 200 });
            }

            // Bukan echo — pesan asli yang dikirim manual dari HP operator.
            // Baru sekarang cari/buat thread.
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
                p_wpp_id: wppId ?? null,
              });
            }
          } catch (err) {
            console.error(`[Webhook] Error handling native outgoing message: ${err} | ${logCtx}`);
          }
          return new Response("OK", { status: 200 });
        }



        const dedupKey = buildDedupKey(wppId, sender, displayMessage);
        if (isDuplicate(dedupKey) || isDuplicateBody(sender, displayMessage)) {
          console.log(`[Webhook] duplicate | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const { messageId, duplicate, error: saveErr } = await saveInboundMessage(
          supabaseAdmin,
          { phone: customerPhone, name, body: displayMessage, wppId, externalChatId: event.externalChatId },
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

        // Deteksi "bukti transfer via teks" (mis. "sudah transfer kak",
        // "sy udh bayar") supaya routing-debug bisa mengukur berapa banyak
        // percakapan yang butuh pipeline finance tanpa attachment gambar.
        const paymentProofText =
          !attachmentUrl &&
          /\b(sudah|udh|udah|dh|sdh)\s*(transfer|tf|bayar|byr|kirim)\b|\b(bukti|bukti transfer|proof)\b|\bslip\s*(transfer|tf)\b/i.test(
            displayMessage,
          );

        runBackground(saveMessageMetadata(supabaseAdmin, {
          messageId,
          metadata: {
            intent_label: classifyMessageIntent(displayMessage),
            attachment_url: attachmentUrl ?? null,
            media_url: attachmentUrl ?? null,
            file_name: attachmentName ?? null,
            mime_type: attachmentMime ?? null,
            media_type: messageType ?? null,
            wpp_id: wppId ?? null,
            external_chat_id: event.externalChatId ?? null,
            wa_identity: event.customerIdentity ?? null,
            wa_identity_candidates: event.customerIdentity?.identityCandidates ?? [],
            identity_unresolved: event.customerIdentity?.identityUnresolved ?? false,
            attachment: attachmentUrl
              ? {
                  url: attachmentUrl,
                  file_name: attachmentName ?? null,
                  mime_type: attachmentMime ?? null,
                  type: messageType ?? null,
                }
              : null,
            ...(paymentProofText
              ? { intent_hint: "payment_proof_text", needs_finance_followup: true }
              : {}),
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
        // pipeline finance kotor. WPPConnect kadang tidak memberi URL —
        // dalam kasus itu kita andalkan messageType/mime.
        const isImageMessage = (() => {
          const mime = (attachmentMime ?? "").toLowerCase();
          if (mime.startsWith("image/")) return true;
          if ((messageType ?? "").toLowerCase() === "image") return true;
          if (attachmentUrl && /\.(jpe?g|png|webp|heic|heif|gif)(\?|$)/i.test(attachmentUrl)) return true;
          return false;
        })();




        let { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
          "get_autoreply_context",
          { p_phone: customerPhone },
        );

        if ((ctxErr || !ctx) && event.externalChatId && event.externalChatId !== customerPhone) {
          const retry = await (supabaseAdmin as any).rpc(
            "get_autoreply_context",
            { p_phone: event.externalChatId },
          );
          ctx = retry.data;
          ctxErr = retry.error;
        }

        if (ctxErr || !ctx) {
          console.error(`[Webhook] context RPC error: ${ctxErr?.message ?? "no context"} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id: string;
          thread_phone?: string | null;
          canonical_phone?: string | null;
          auto_reply_enabled: boolean;
          wpp_token: string;
          smart_delay_config?: Record<string, unknown> | null;
        };

        // OCR bukti transfer — sekarang sesudah `c` tersedia supaya kita bisa
        // ambil media base64 lewat WPPConnect (`get-media-by-message`) pakai
        // c.wpp_token. Tetap SEBELUM gate auto_reply_enabled: OCR & notifikasi
        // manajer harus jalan meski auto-reply mati.
        if (isImageMessage) {
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
              let imageForOcr: string | null = attachmentUrl ?? null;
              if (!imageForOcr && isImageMessage && wppId && c.wpp_token) {
                const { fetchWppMediaDataUri } = await import("@/services/whatsapp.service");
                imageForOcr = await fetchWppMediaDataUri(c.wpp_token, wppId);
              }
              if (!imageForOcr) {
                console.warn("[Webhook] payment_proof: tidak ada image (URL/data URI) — skip OCR");
                return;
              }
              const { analyzePaymentProof } = await import("@/services/payment-proof.service");
              const ocrResult = await analyzePaymentProof(
                supabaseAdmin as any,
                imageForOcr,
                customerPhone,
                messageId,
              );

              // Selalu beri tahu manajer (OCR + teks) — meski gambar via
              // WPPConnect tidak punya URL publik. imageUrl opsional: kalau
              // undefined, notif dikirim teks saja tanpa forward gambar.
              const { notifyPaymentProof } = await import("@/services/manager-notifier.service");
              await notifyPaymentProof(supabaseAdmin as any, {
                threadId: null,
                phone: customerPhone,
                guestName: name,
                imageUrl: attachmentUrl ?? undefined,
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

        let isManager = false;
        try {
          const { resolveManagerByPhone, isManagerInGuestMode } = await import("@/services/wa-autoreply.service");
          const mgr = await resolveManagerByPhone(customerPhone);
          // Hormati guest-mode: manager yang sedang menguji alur tamu tidak
          // dianggap manager di gate auto_reply agar bisa disimulasikan penuh.
          isManager = !!mgr && !(await isManagerInGuestMode(customerPhone));
        } catch (e) {
          console.warn(`[Webhook] resolveManagerByPhone failed (non-fatal): ${e} | ${logCtx}`);
        }

        if (!isManager && !c.auto_reply_enabled) {
          console.log(`[Webhook] auto_reply_enabled=false — skipping | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!c.wpp_token) {
          console.error(`[Webhook] wpp_token not configured | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        try {
          const { resolveQueueTiming, queueUpsert, queueCleanupZombies } = await import("@/services/queue.service");
          const { delayMs, maxWaitMs } = resolveQueueTiming(message, c.smart_delay_config as any);

          await queueCleanupZombies(supabaseAdmin);
          const queuePhone = c.canonical_phone || c.thread_phone || event.externalChatId || customerPhone;

          const entry = await queueUpsert(supabaseAdmin, {
            phone: queuePhone,
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
};

export const wppWebhookGet = async ({ request }: { request: Request }): Promise<Response> => {
        const url = new URL(request.url);

        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyWppToken(request)) {
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
            env_token_set: !!process.env.WPP_WEBHOOK_TOKEN,
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
              report.wpp_token_set = !!(c.wpp_token as string)?.length;
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
              wpp_token: string;
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

            if (url.searchParams.get("send") === "1" && orchResult.reply && c.wpp_token) {
              const { ok, error: sendErr } = await sendWhatsAppMessage(
                c.wpp_token,
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
};

export const Route = createFileRoute("/api/wpp")({
  server: {
    handlers: {
      POST: wppWebhookPost,
      GET: wppWebhookGet,
    },
  },
});
