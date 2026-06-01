-- ============================================================
-- Telegram per-chat per-agent conversation history.
--
-- Each Telegram message currently triggers a fresh agent run with
-- no memory of prior turns — so "publish saja" cannot reference
-- yesterday's discovery, and follow-up clarifications start over.
-- This table stores a rolling window of turns scoped by
-- (chat_id, message_thread_id, agent_key) so each per-agent bot
-- has its own context within each chat / topic.
--
-- Layout: one row per scope, with the full `turns` array in JSONB.
-- Cheap to load (single row fetch) and update (single UPSERT) per
-- guest turn. We trim to MAX_TURNS in the service layer before
-- writing back.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_chat_history (
  chat_id           TEXT NOT NULL,
  message_thread_id TEXT NOT NULL DEFAULT '',
  agent_key         TEXT NOT NULL,
  turns             JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, message_thread_id, agent_key)
);

CREATE INDEX IF NOT EXISTS idx_tg_history_updated
  ON public.telegram_chat_history(updated_at DESC);

ALTER TABLE public.telegram_chat_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage telegram_chat_history"
  ON public.telegram_chat_history;
CREATE POLICY "Staff manage telegram_chat_history"
  ON public.telegram_chat_history FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
