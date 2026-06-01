/**
 * /api/telegram/$agentKey — per-agent Telegram webhook.
 *
 * Each agent (front-office, pricing, customer-care, finance, content,
 * manager) owns its OWN Telegram bot. setWebhook is configured per bot
 * to point here with the agent_key in the path, so when an update
 * arrives we know which agent owns the bot and we don't need to
 * disambiguate by token.
 *
 * The legacy /api/telegram route (property-wide single bot) still
 * works untouched — both paths can coexist.
 */

import { createFileRoute }     from "@tanstack/react-router";
import { supabaseAdmin }       from "@/integrations/supabase/client.server";
import { handleTelegramUpdate } from "@/services/telegram-router";
import { getWaitUntil }         from "@/lib/cf-context";

const ALLOWED = new Set([
  "front-office", "pricing", "customer-care", "finance", "content", "manager",
]);

async function loadAgentBot(agentKey: string) {
  const { data } = await (supabaseAdmin as any)
    .from("telegram_agent_bots")
    .select("bot_token, webhook_secret, is_active")
    .eq("agent_key", agentKey)
    .maybeSingle();
  return data as { bot_token: string; webhook_secret: string | null; is_active: boolean } | null;
}

export const Route = createFileRoute("/api/telegram/$agentKey")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const agentKey = String(params.agentKey ?? "").toLowerCase();
        if (!ALLOWED.has(agentKey)) {
          return new Response("unknown agent", { status: 404 });
        }
        const bot = await loadAgentBot(agentKey);
        if (!bot?.bot_token || !bot.is_active) {
          // Bot not configured / inactive — silently 200 so Telegram
          // stops retrying. Admin sees this state in the diagnostics card.
          return new Response("ok", { status: 200 });
        }

        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (bot.webhook_secret && headerSecret !== bot.webhook_secret) {
          console.warn(`[TelegramWebhook][${agentKey}] secret mismatch — rejecting`);
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
        console.info(`[TelegramWebhook][${agentKey}] update received (${updateKind})`);

        const task = handleTelegramUpdate({
          update,
          botToken:   bot.bot_token,
          propertyId: "",            // not needed for per-agent path
          forcedAgentKey: agentKey,  // bypass channel mapping lookup — this bot IS the agent
        }).catch((e) => console.error(`[TelegramWebhook][${agentKey}] handler error:`, e));

        const waitUntil = getWaitUntil();
        if (waitUntil) waitUntil(task);
        else await task;

        return new Response("ok", { status: 200 });
      },
    },
  },
});
