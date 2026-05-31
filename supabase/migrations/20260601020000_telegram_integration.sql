-- ============================================================
-- Telegram integration: per-manager linking + per-property bot
-- config + channel-aware notification dedup.
-- ============================================================

-- Per-manager: one Telegram chat per manager (DM with the bot)
ALTER TABLE public.property_managers
  ADD COLUMN IF NOT EXISTS telegram_chat_id      TEXT,
  ADD COLUMN IF NOT EXISTS telegram_link_token   TEXT,
  ADD COLUMN IF NOT EXISTS telegram_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_linked_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_managers_telegram_chat
  ON public.property_managers(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managers_telegram_token
  ON public.property_managers(telegram_link_token)
  WHERE telegram_link_token IS NOT NULL;

-- Per-property: bot token from @BotFather + webhook secret
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS telegram_bot_token      TEXT,
  ADD COLUMN IF NOT EXISTS telegram_bot_username   TEXT,
  ADD COLUMN IF NOT EXISTS telegram_webhook_secret TEXT;

-- Channel-aware dedup. Existing dedupe_key was unique on its own; expand
-- so the same notification can be sent to both WA and Telegram channels
-- without colliding, but stays unique per (channel, dedupe_key).
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'wa';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_logs_dedupe_key_key'
  ) THEN
    ALTER TABLE public.notification_logs
      DROP CONSTRAINT notification_logs_dedupe_key_key;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_logs_dedupe_per_channel
  ON public.notification_logs(channel, dedupe_key);
