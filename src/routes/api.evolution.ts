/**
 * /api/evolution - Evolution API webhook endpoint.
 *
 * This mirrors the Evolution API webhook path, but normalizes Evolution/Baileys
 * payloads where a chat can arrive as `remoteJid=@lid` with the public WhatsApp
 * number in `remoteJidAlt`. Supabase remains the primary conversation DB.
 */

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseEvolutionWebhook } from "@/webhook/parser";
import { buildDedupKey, isDuplicate, isDuplicateBody } from "@/webhook/deduplicator";
import { classifyMessageIntent } from "@/webhook/intent-classifier";
import { saveInboundMessage, saveMessageMetadata } from "@/repositories/message.repository";
import { resolveHumanTakeoverMs } from "@/admin/modules/ai-lab/ai-lab.functions";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function evolutionDataKey(rawBody: unknown): unknown {
  const data = (rawBody as any)?.data;
  if (Array.isArray(data)) return data[0]?.key ?? null;
  return data?.key ?? null;
}

function expectedWebhookToken(): string | undefined {
  return process.env.EVOLUTION_WEBHOOK_TOKEN || process.env.WPP_WEBHOOK_TOKEN;
}

function expectedQueueToken(): string | undefined {
  return process.env.QUEUE_WORKER_TOKEN || process.env.EVOLUTION_WEBHOOK_TOKEN || process.env.WPP_WEBHOOK_TOKEN;
}

type AuthResult = { ok: true } | { ok: false; status: 403 | 503; reason: string };

/**
 * Fail-CLOSED (audit 7 Agu 2026 — S4). Versi lama mengembalikan `true` bila
 * env token kosong, sehingga hilangnya `EVOLUTION_WEBHOOK_TOKEN` (salah deploy,
 * rotasi env, clone project) membuka endpoint ini untuk siapa saja: pesan tamu
 * palsu tersimpan, antrian terisi, LLM jalan, dan WhatsApp mengirim balasan ke
 * nomor pilihan penyerang. Endpoint yang membelanjakan uang tidak boleh
 * terbuka karena konfigurasi yang hilang.
 */
function authorize(request: Request): AuthResult {
  const expected = expectedWebhookToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      reason:
        "EVOLUTION_WEBHOOK_TOKEN / WPP_WEBHOOK_TOKEN belum diset — webhook menolak semua request.",
    };
  }

  const url = new URL(request.url);
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apikeyHeader = request.headers.get("apikey");
  const provided =
    url.searchParams.get("token") === expected ||
    authHeader === expected ||
    apikeyHeader === expected;

  return provided ? { ok: true } : { ok: false, status: 403, reason: "token mismatch" };
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
      const queueToken = expectedQueueToken();
      const res = await fetch(`${origin}/api/queue-worker`, {
        method: "POST",
        headers: queueToken ? { "x-queue-token": queueToken } : undefined,
      });
      if (!res.ok) {
        console.warn(`[EvolutionWebhook] queue nudge failed status=${res.status} | ${logCtx}`);
      }
    } catch (e) {
      console.warn(`[EvolutionWebhook] queue nudge failed: ${e} | ${logCtx}`);
    }
  })());
}

export const evolutionWebhookPost = async ({ request }: { request: Request }): Promise<Response> => {
  const workerId = `evo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const auth = authorize(request);
  if (!auth.ok) {
    console.error(`[EvolutionWebhook] REJECTED: ${auth.reason}`);
    return json(
      { error: auth.status === 503 ? "Webhook not configured" : "Unauthorized" },
      auth.status,
    );
  }

  const event = await parseEvolutionWebhook(request);
  if (!event) return new Response("OK", { status: 200 });

  const {
    message,
    name,
    wppId,
    isOutgoing,
    customerPhone,
    attachmentUrl,
    attachmentName,
    attachmentMime,
    messageType,
  } = event;

  const displayMessage =
    message ||
    (attachmentUrl || attachmentMime || messageType ? `[Lampiran ${messageType ?? attachmentMime ?? "media"}]` : "");
  const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;

  console.log("[EvolutionWebhook]", {
    customerPhone,
    isOutgoing,
    externalChatId: event.externalChatId,
    hasAttachment: !!attachmentUrl,
    msg: displayMessage.slice(0, 60),
  });

  // Outgoing (fromMe): either an echo of a reply WE sent (AI/app) OR a native
  // human reply typed directly from the operator's WhatsApp phone. Persist the
  // latter so it appears in the admin inbox; skip the former to avoid duplicates.
  if (isOutgoing) {
    try {
      // 1) Dedup by provider message id — echo of our own API send.
      if (wppId) {
        const { data: existingById } = await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .select("id")
          .eq("wpp_id", wppId)
          .maybeSingle();
        if (existingById) return new Response("OK", { status: 200 });
      }

      // 2) Fallback body-dedup (2 min): echo of a message the app just sent.
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
        if (wppId) {
          await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .update({ wpp_id: wppId })
            .eq("id", existingByBody.id)
            .is("wpp_id", null);
        }
        return new Response("OK", { status: 200 });
      }

      // 3) Genuine native human reply from the operator's phone — find/create
      //    the thread, then store it as an outbound message.
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
            provider: "evolution-api",
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
        console.log(
          `[EvolutionWebhook] native human reply stored (thread=${String(threadId).slice(0, 8)}) | ${logCtx}`,
        );

        // Timed human-takeover: pause AI for this thread (sliding window).
        const pauseMs = await resolveHumanTakeoverMs(supabaseAdmin);
        if (pauseMs > 0) {
          await (supabaseAdmin as any)
            .from("whatsapp_threads")
            .update({ ai_paused_until: new Date(Date.now() + pauseMs).toISOString() })
            .eq("id", threadId);
        }
      }
    } catch (err) {
      console.error(`[EvolutionWebhook] Error handling native outgoing message: ${err} | ${logCtx}`);
    }
    return new Response("OK", { status: 200 });
  }

  const dedupKey = buildDedupKey(wppId, customerPhone, displayMessage);
  if (isDuplicate(dedupKey) || isDuplicateBody(customerPhone, displayMessage)) {
    console.log(`[EvolutionWebhook] duplicate | ${logCtx}`);
    return new Response("OK", { status: 200 });
  }

  const { messageId, duplicate, error: saveErr } = await saveInboundMessage(
    supabaseAdmin,
    {
      phone: customerPhone,
      name,
      body: displayMessage,
      wppId,
      externalChatId: event.externalChatId,
    },
  );

  if (saveErr || !messageId) {
    console.error(`[EvolutionWebhook] saveInbound failed: ${saveErr?.message ?? "no messageId"} | ${logCtx}`);
    return json({ error: "saveInbound failed" }, 500);
  }
  if (duplicate) {
    console.log(`[EvolutionWebhook] duplicate persisted inbound | ${logCtx}`);
    return new Response("OK", { status: 200 });
  }

  const runBackground = await getWaitUntilRunner();

  runBackground(saveMessageMetadata(supabaseAdmin, {
    messageId,
    metadata: {
      source: "evolution",
      provider: "evolution-api",
      intent_label: classifyMessageIntent(displayMessage),
      attachment_url: attachmentUrl ?? null,
      media_url: attachmentUrl ?? null,
      file_name: attachmentName ?? null,
      mime_type: attachmentMime ?? null,
      media_type: messageType ?? null,
      external_chat_id: event.externalChatId ?? null,
      evolution_instance: (event.rawBody as any)?.instance ?? null,
      evolution_event: (event.rawBody as any)?.event ?? null,
      evolution_key: evolutionDataKey(event.rawBody),
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
    },
  }).catch((e) => console.warn("[EvolutionWebhook] metadata save failed:", e)));

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
      console.warn("[EvolutionWebhook] notifyIncomingMessage failed (non-fatal):", e);
    }
  })());

  try {
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
      console.error(`[EvolutionWebhook] context RPC error: ${ctxErr?.message ?? "no context"} | ${logCtx}`);
      return new Response("OK", { status: 200 });
    }

    const c = ctx as {
      thread_id: string;
      thread_phone?: string | null;
      canonical_phone?: string | null;
      auto_reply_enabled: boolean;
      smart_delay_config?: Record<string, unknown> | null;
    };

    if (!c.auto_reply_enabled) {
      console.log(`[EvolutionWebhook] auto_reply_enabled=false - saved only | ${logCtx}`);
      return new Response("OK", { status: 200 });
    }

    const { resolveQueueTiming, queueCleanupZombies, queueUpsert } = await import("@/services/queue.service");
    const { delayMs, maxWaitMs } = resolveQueueTiming(displayMessage, c.smart_delay_config as any);

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
      `[EvolutionWebhook] Enqueued (entry=${entry?.entryId?.slice(0, 8) ?? "none"} delay=${delayMs}ms) | ${logCtx}`,
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
    console.error(`[EvolutionWebhook] enqueue error: ${e} | ${logCtx}`);
  }

  return new Response("OK", { status: 200 });
};

export const evolutionWebhookGet = async ({ request }: { request: Request }): Promise<Response> => {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "1") {
    const auth = authorize(request);
    if (!auth.ok) {
      console.warn(`[EvolutionWebhook] debug rejected: ${auth.reason}`);
      return json({ error: auth.status === 503 ? "Webhook not configured" : "Unauthorized" }, auth.status);
    }
    return json({
      ok: true,
      route: "/api/evolution",
      token_set: !!expectedWebhookToken(),
      queue_token_set: !!expectedQueueToken(),
      supabase_url_set: !!process.env.SUPABASE_URL,
      supabase_service_key_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      provider: process.env.WHATSAPP_PROVIDER ?? "evolution",
      evolution_base_url_set: !!process.env.EVOLUTION_BASE_URL,
      evolution_instance_set: !!process.env.EVOLUTION_INSTANCE,
      evolution_api_key_set: !!process.env.EVOLUTION_API_KEY,
    });
  }
  return new Response("Evolution webhook is active", { status: 200 });
};

export const Route = createFileRoute("/api/evolution")({
  server: {
    handlers: {
      POST: evolutionWebhookPost,
      GET: evolutionWebhookGet,
    },
  },
});
