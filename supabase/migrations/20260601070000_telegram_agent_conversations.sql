-- ============================================================
-- Per-(chat, thread, agent) conversation history for Telegram
-- agent bots. Each row holds the recent message turns so that the
-- agent has memory across separate Telegram messages instead of
-- treating every message as a cold start.
--
-- One row per unique (chat_id, message_thread_id, agent_key) tuple.
-- message_thread_id is nullable for non-forum groups / DMs; we use
-- a generated coalesce column for uniqueness so the NULL case
-- behaves as a single canonical row.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_agent_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id           TEXT NOT NULL,
  message_thread_id TEXT,
  agent_key         TEXT NOT NULL,
  -- Array of AiMessage objects ({role, content, tool_calls?, tool_call_id?}).
  -- Trimmed by the application layer to the most recent N turns to keep
  -- token budget bounded.
  messages          JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness across (chat, thread, agent). COALESCE so NULL threads
-- collapse to a single row per (chat, agent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_agent_conv_unique
  ON public.telegram_agent_conversations
     (chat_id, agent_key, COALESCE(message_thread_id, ''));

ALTER TABLE public.telegram_agent_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage telegram_agent_conversations"
  ON public.telegram_agent_conversations;
CREATE POLICY "Staff manage telegram_agent_conversations"
  ON public.telegram_agent_conversations FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
