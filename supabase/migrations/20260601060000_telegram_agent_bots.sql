-- ============================================================
-- Per-agent Telegram bots: each agent owns its OWN Telegram bot
-- (different @BotFather token, different bot username, different
-- avatar), so when the bots co-exist in a single Telegram group the
-- members see distinct "speakers" — Rania (Front Office), Julia
-- (Pricing), Santi (Finance), etc. — instead of one bot replying
-- with rotating personas.
--
-- The single property-wide token in properties.telegram_bot_token is
-- kept as a fallback for legacy code paths (notification logs,
-- single-bot setups). Per-agent rows take precedence when present.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_agent_bots (
  agent_key       TEXT PRIMARY KEY,
  bot_token       TEXT NOT NULL,
  bot_username    TEXT,
  webhook_secret  TEXT,
  webhook_set_at  TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_agent_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage telegram_agent_bots"
  ON public.telegram_agent_bots;
CREATE POLICY "Staff manage telegram_agent_bots"
  ON public.telegram_agent_bots FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Allow lookup by webhook secret (constant-time best-effort check at
-- the application layer, with an index for the common case).
CREATE INDEX IF NOT EXISTS idx_telegram_agent_bots_secret
  ON public.telegram_agent_bots(webhook_secret)
  WHERE webhook_secret IS NOT NULL;
