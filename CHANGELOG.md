# Changelog

## 2026-10-09 — WhatsApp is Meta Cloud API only

Removed the retired Evolution API gateway (routes, inbox poll, send fallback, admin token/webhook UI, and `EVOLUTION_*` env usage).

Outbound bot replies, invoices, brochures, staff notifications, admin replies at `/admin/whatsapp`, and the Android admin app now send only through Meta (`LOVABLE_API_KEY` / `WHATSAPP_API_KEY`).

Guest history in `whatsapp_threads` and `whatsapp_messages` is kept. Apply `supabase/migrations/20261009183000_drop_evolution.sql` manually after deploy. The job `evolution-inbox-poll` was already unscheduled in production on 9 Oct 2026; the migration unschedules it again if it is still present.

The already-applied scheduler file `supabase/migrations/20260819053800_51c5bab4-869c-4db7-a8e6-c305749da18a.sql` still contains the original `cron.schedule('evolution-inbox-poll', ...)` statement. It is left unchanged so migration history stays valid. Comment-only wording in `20260930140000_wa_inbound_push_hardening.sql` was updated; the SQL itself is unchanged.
