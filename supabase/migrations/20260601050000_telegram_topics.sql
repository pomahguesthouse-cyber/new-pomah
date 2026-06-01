-- ============================================================
-- Telegram Topics support: one supergroup with multiple threads,
-- each thread mapped to a different agent. Hotels with a single
-- "operations command center" supergroup can now keep all chatter
-- in one place with separate threads per role.
--
-- Telegram identifies threads via message_thread_id (an int). We
-- store it as TEXT to keep parity with chat_id and allow NULL for
-- regular (non-topic) chats — preserves backward compat with
-- group bindings created before this migration.
-- ============================================================

ALTER TABLE public.telegram_agent_channels
  ADD COLUMN IF NOT EXISTS message_thread_id TEXT;

-- Drop the old chat_id-only unique index; replace with composite
-- (chat_id, message_thread_id). A NULL thread_id means "the whole
-- chat" (legacy group binding); we coalesce to '' so two NULLs
-- collide and behave like unique-per-chat for non-topic groups.
DROP INDEX IF EXISTS idx_telegram_agent_channels_chat;
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_agent_channels_chat_thread
  ON public.telegram_agent_channels(chat_id, COALESCE(message_thread_id, ''));
