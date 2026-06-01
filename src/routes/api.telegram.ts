/**
 * /api/telegram — Telegram Bot Webhook
 *
 * Receives:
 *   - message updates (text, photo, document)
 *   - callback_query updates (inline keyboard button presses)
 *
 * Auth flow:
 *   - X-Telegram-Bot-Api-Secret-Token must match property.telegram_webhook_secret
 *   - chat must be linked to an active property_manager (via /start <token>)
 *
 * Routing:
 *   - /start <token>  → consume one-time link token, bind chat_id to manager
 *   - any other text  → handle via Manager Agent (multi-agent orchestrator)
 *   - photo/document  → run payment-proof OCR, then Manager Agent (will see
 *                       ctx.recentOcrResult, can confirm/escalate)
 *   - callback_query  → action dispatcher (mark_paid, reject, etc.)
 */

import { createFileRoute }     from "@tanstack/react-router";
import { supabaseAdmin }       from "@/integrations/supabase/client.server";
import { handleTelegramUpdate } from "@/services/telegram-router";
import { getWaitUntil }         from "@/lib/cf-context";

interface TgProperty {
  id: string;
  telegram_bot_token:      string | null;
  telegram_webhook_secret: string | null;
}

async function loadActiveBotProperty(): Promise<TgProperty | null> {
  const { data } = await (supabaseAdmin as any)
    .from("properties")
    .select("id, telegram_bot_token, telegram_webhook_secret")
    .not("telegram_bot_token", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as TgProperty | null) ?? null;
}

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const property = await loadActiveBotProperty();
        if (!property?.telegram_bot_token) {
          // Bot not configured — silently accept so Telegram stops retrying.
          return new Response("ok", { status: 200 });
        }

        // Verify the secret token Telegram echoes from setWebhook.
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (
          property.telegram_webhook_secret &&
          headerSecret !== property.telegram_webhook_secret
        ) {
          console.warn("[TelegramWebhook] secret mismatch — rejecting");
          return new Response("forbidden", { status: 403 });
        }

        let update: any;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const updateKind =
          update.callback_query ? "callback_query" :
          update.message?.text ? "text" :
          update.message?.photo ? "photo" :
          update.message?.document ? "document" :
          "other";
        console.info(`[TelegramWebhook] update received (${updateKind})`);

        // Cloudflare Workers will kill any async work after the response
        // returns UNLESS we register it via ctx.waitUntil — otherwise our
        // bot stays silent even though Telegram thinks delivery succeeded
        // (pending_update_count stays at 0). Fall back to awaiting in
        // non-Worker runtimes (local dev, tests).
        const task = handleTelegramUpdate({
          update,
          botToken:   property.telegram_bot_token,
          propertyId: property.id,
        }).catch((e) => console.error("[TelegramWebhook] handler error:", e));

        const waitUntil = getWaitUntil();
        if (waitUntil) {
          waitUntil(task);
        } else {
          await task;
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
