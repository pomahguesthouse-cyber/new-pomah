# Changelog

## 2026-10-09 — Telegram AI chat removed

Removed the Telegram AI chat bot: `/api/telegram`, `/api/telegram/$agentKey`, Admin → Telegram (bots, linking, group bindings), the settings bot-token field, and the chat services. Staff alerts stay on WhatsApp and push. WhatsApp guest chat, AI agents, the manager notifier, the conversation monitor, and push are unchanged.

Apply `supabase/migrations/20261010020000_drop_telegram.sql` manually after deploy. It drops `telegram_agent_conversations`, `telegram_agent_bots`, `telegram_agent_channels`, and `telegram_chat_history`, the `properties.telegram_*` columns, the `property_managers.telegram_*` columns (including `telegram_chat_id`), `conversation_alerts.telegram_message_id`, the link-token guard, and any cron job whose name or command matches telegram. Bookings, prices, and WhatsApp history are not touched.

Before applying, run the preflight in the pull request (row counts, columns, cron jobs, bot usernames only). Then delete each bot webhook (`deleteWebhook`) and revoke the bot token in BotFather. The only username written in product code is `rania_pomah_bot`; live usernames are in `properties.telegram_bot_username` and `telegram_agent_bots.bot_username`.

## 2026-10-09 — WhatsApp is Meta Cloud API only

Removed the retired Evolution API gateway (routes, inbox poll, send fallback, admin token/webhook UI, and `EVOLUTION_*` env usage).

Outbound bot replies, invoices, brochures, staff notifications, admin replies at `/admin/whatsapp`, and the Android admin app now send only through Meta (`LOVABLE_API_KEY` / `WHATSAPP_API_KEY`).

Guest history in `whatsapp_threads` and `whatsapp_messages` is kept. Apply `supabase/migrations/20261009183000_drop_evolution.sql` manually after deploy. The job `evolution-inbox-poll` was already unscheduled in production on 9 Oct 2026; the migration unschedules it again if it is still present.

The already-applied scheduler file `supabase/migrations/20260819053800_51c5bab4-869c-4db7-a8e6-c305749da18a.sql` still contains the original `cron.schedule('evolution-inbox-poll', ...)` statement. It is left unchanged so migration history stays valid. Comment-only wording in `20260930140000_wa_inbound_push_hardening.sql` was updated; the SQL itself is unchanged.
