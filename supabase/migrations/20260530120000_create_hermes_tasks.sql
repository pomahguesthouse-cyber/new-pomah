-- ============================================================
-- Hermes Agent — task log table
-- ============================================================
--
-- Pola A integration: Hermes (running locally + bridged via Telegram)
-- writes every completed task here using the Supabase service role key.
-- The SEO Admin page reads from this table and displays a feed.
--
-- The web app NEVER writes here — only Hermes does. Hence no auth
-- mutation endpoints; admin can only SELECT and DELETE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hermes_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Where the task came from (Telegram chat reference)
  source_chat_id  TEXT,
  source_username TEXT,
  source_message_id TEXT,

  -- What kind of task ('landing_page', 'keyword_research', 'content',
  -- 'schema', 'general', etc — free-form, validated at app layer)
  task_type       TEXT NOT NULL DEFAULT 'general',

  -- Human-readable summary and details
  title           TEXT NOT NULL,
  prompt          TEXT,
  output          TEXT,

  -- 'pending' | 'in_progress' | 'completed' | 'failed'
  status          TEXT NOT NULL DEFAULT 'completed',
  error_message   TEXT,

  -- Free-form payload (model name, tokens, files, etc)
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS hermes_tasks_created_at_idx
  ON public.hermes_tasks (created_at DESC);

CREATE INDEX IF NOT EXISTS hermes_tasks_task_type_idx
  ON public.hermes_tasks (task_type);

CREATE INDEX IF NOT EXISTS hermes_tasks_status_idx
  ON public.hermes_tasks (status);

-- Keep updated_at fresh on UPDATE
CREATE OR REPLACE FUNCTION public.hermes_tasks_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hermes_tasks_touch_updated_at ON public.hermes_tasks;
CREATE TRIGGER hermes_tasks_touch_updated_at
  BEFORE UPDATE ON public.hermes_tasks
  FOR EACH ROW EXECUTE FUNCTION public.hermes_tasks_touch_updated_at();

-- RLS: authenticated admin can read & delete. Inserts/updates restricted to
-- the service role (which Hermes uses via the Supabase service key).
ALTER TABLE public.hermes_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hermes_tasks_select_authenticated" ON public.hermes_tasks;
CREATE POLICY "hermes_tasks_select_authenticated"
  ON public.hermes_tasks
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hermes_tasks_delete_authenticated" ON public.hermes_tasks;
CREATE POLICY "hermes_tasks_delete_authenticated"
  ON public.hermes_tasks
  FOR DELETE
  TO authenticated
  USING (true);

-- Grants — service_role bypasses RLS but we grant explicitly for clarity
GRANT SELECT, DELETE ON public.hermes_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_tasks TO service_role;
