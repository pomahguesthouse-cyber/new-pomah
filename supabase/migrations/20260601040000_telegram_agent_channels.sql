-- ============================================================
-- Per-agent Telegram channels (groups). Each row maps one chat
-- (DM or group) to the specific agent that owns that conversation,
-- so an admin can dedicate a Telegram group to e.g. Front Office
-- and another to Finance — notifications about bookings land in the
-- Front Office group, payment proofs land in the Finance group, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_agent_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     TEXT NOT NULL,
  agent_key   TEXT NOT NULL,
  -- 'group' | 'supergroup' | 'channel' | 'private' (informational)
  chat_type   TEXT,
  label       TEXT,           -- friendly name shown in admin UI
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A single chat is bound to exactly one agent (no fan-out per message
-- inside the same chat; the admin uses separate chats for separate
-- agents).
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_agent_channels_chat
  ON public.telegram_agent_channels(chat_id);

-- Quick lookup by agent_key for the notifier fan-out path.
CREATE INDEX IF NOT EXISTS idx_telegram_agent_channels_agent
  ON public.telegram_agent_channels(agent_key)
  WHERE is_active = TRUE;

ALTER TABLE public.telegram_agent_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage telegram_agent_channels"
  ON public.telegram_agent_channels;
CREATE POLICY "Staff manage telegram_agent_channels"
  ON public.telegram_agent_channels FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
