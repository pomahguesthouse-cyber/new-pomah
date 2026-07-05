-- ============================================================
-- WhatsApp Corrections: ignored/hidden threads for training
-- ============================================================
-- This does NOT delete whatsapp_threads or whatsapp_messages.
-- It only hides a conversation from the correction/training UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wa_training_ignored_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES public.whatsapp_threads(id) ON DELETE CASCADE,
  phone       text,
  display_name text,
  reason      text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','restored')),
  ignored_by  uuid,
  ignored_at  timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_training_ignored_threads_active
  ON public.wa_training_ignored_threads(thread_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.touch_wa_training_ignored_threads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_wa_training_ignored_threads ON public.wa_training_ignored_threads;
CREATE TRIGGER trg_touch_wa_training_ignored_threads
BEFORE UPDATE ON public.wa_training_ignored_threads
FOR EACH ROW EXECUTE FUNCTION public.touch_wa_training_ignored_threads_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_training_ignored_threads TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
