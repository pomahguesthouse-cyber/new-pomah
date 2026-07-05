-- ============================================================
-- WPPConnect mirror sync metadata
-- ============================================================
-- WPPConnect remains the live WhatsApp mirror/source. Supabase keeps a durable
-- searchable mirror for admin UI, corrections, embeddings, and training.
-- ============================================================

ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS external_chat_id text,
  ADD COLUMN IF NOT EXISTS canonical_phone text,
  ADD COLUMN IF NOT EXISTS identity_type text,
  ADD COLUMN IF NOT EXISTS lid_alias text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'webhook_only',
  ADD COLUMN IF NOT EXISTS sync_error text;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'webhook',
  ADD COLUMN IF NOT EXISTS external_message_id text,
  ADD COLUMN IF NOT EXISTS external_chat_id text,
  ADD COLUMN IF NOT EXISTS from_me boolean,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'webhook_only';

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_external_message_id
  ON public.whatsapp_messages(external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_threads_external_chat_id
  ON public.whatsapp_threads(external_chat_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_threads_last_synced_at
  ON public.whatsapp_threads(last_synced_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sync
  ON public.whatsapp_messages(thread_id, synced_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.wa_wpp_sync_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       text NOT NULL,
  thread_id       uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  phone           text,
  external_chat_id text,
  status          text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','success','failed','partial')),
  started_at      timestamptz,
  finished_at     timestamptz,
  last_synced_at  timestamptz,
  last_cursor     text,
  imported_count  integer NOT NULL DEFAULT 0,
  updated_count   integer NOT NULL DEFAULT 0,
  skipped_count   integer NOT NULL DEFAULT 0,
  error_message   text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_wpp_sync_state_type
  ON public.wa_wpp_sync_state(sync_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_wpp_sync_state_thread
  ON public.wa_wpp_sync_state(thread_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_wa_wpp_sync_state_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_wa_wpp_sync_state ON public.wa_wpp_sync_state;
CREATE TRIGGER trg_touch_wa_wpp_sync_state
BEFORE UPDATE ON public.wa_wpp_sync_state
FOR EACH ROW EXECUTE FUNCTION public.touch_wa_wpp_sync_state_updated_at();

CREATE OR REPLACE FUNCTION public.mark_wpp_thread_synced(
  p_thread_id uuid,
  p_external_chat_id text DEFAULT NULL,
  p_status text DEFAULT 'synced',
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.whatsapp_threads
  SET external_chat_id = COALESCE(NULLIF(p_external_chat_id, ''), external_chat_id),
      canonical_phone = public.resolve_wa_canonical_phone(phone),
      last_synced_at = now(),
      sync_status = COALESCE(NULLIF(p_status, ''), 'synced'),
      sync_error = p_error
  WHERE id = p_thread_id;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_wpp_sync_state TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_wpp_thread_synced(uuid, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
