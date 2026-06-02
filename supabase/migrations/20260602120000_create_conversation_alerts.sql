-- ============================================================
-- Conversation Monitor: alert table for problematic WhatsApp
-- guest conversations. Alerts are raised when the system
-- detects repeated/off-context messages, explicit escalation
-- requests, unresponsive threads (>10 min without reply in
-- human-takeover mode), or AI fallback loops.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.conversation_alerts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            UUID        REFERENCES public.whatsapp_threads(id) ON DELETE CASCADE,
  phone                TEXT        NOT NULL,
  guest_name           TEXT,
  -- Trigger classification
  trigger_type         TEXT        NOT NULL
                       CHECK (trigger_type IN (
                         'repetitive',      -- tamu mengirim pesan berulang / off-context
                         'escalation',      -- tamu eksplisit minta manager / eskalasi
                         'unresponsive',    -- pesan tamu tidak dibalas >10 menit (human mode)
                         'fallback_loop',   -- AI gagal >2x berturut-turut
                         'keyword',         -- kata sensitif terdeteksi
                         'manual'           -- dipicu manual oleh admin
                       )),
  trigger_detail       TEXT,              -- deskripsi lengkap trigger
  last_message         TEXT,              -- pesan tamu terakhir yang memicu alert
  ai_status            TEXT DEFAULT 'auto' CHECK (ai_status IN ('auto', 'human')),
  severity             TEXT DEFAULT 'medium'
                       CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  -- Tracking
  status               TEXT DEFAULT 'open'
                       CHECK (status IN ('open', 'handled', 'dismissed')),
  telegram_message_id  TEXT,             -- ID pesan Telegram supaya bisa di-edit saat handled
  handled_by           TEXT,
  handled_at           TIMESTAMPTZ,
  notes                TEXT,
  -- Dedupe: satu alert aktif per thread per trigger_type
  dedupe_key           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index untuk query cepat alert aktif per thread
CREATE INDEX IF NOT EXISTS idx_conv_alerts_thread
  ON public.conversation_alerts(thread_id, status)
  WHERE status = 'open';

-- Index untuk dashboard (semua alert open)
CREATE INDEX IF NOT EXISTS idx_conv_alerts_open
  ON public.conversation_alerts(created_at DESC)
  WHERE status = 'open';

-- Index untuk dedupe check
CREATE INDEX IF NOT EXISTS idx_conv_alerts_dedupe
  ON public.conversation_alerts(dedupe_key, status);

-- Unique: hanya satu alert open per (thread, trigger_type) pada satu waktu
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_alerts_unique_open
  ON public.conversation_alerts(thread_id, trigger_type)
  WHERE status = 'open' AND thread_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_conversation_alerts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conv_alerts_updated_at ON public.conversation_alerts;
CREATE TRIGGER trg_conv_alerts_updated_at
  BEFORE UPDATE ON public.conversation_alerts
  FOR EACH ROW EXECUTE FUNCTION update_conversation_alerts_updated_at();

-- RLS
ALTER TABLE public.conversation_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'conversation_alerts'
      AND policyname = 'staff manage conversation alerts'
  ) THEN
    CREATE POLICY "staff manage conversation alerts"
      ON public.conversation_alerts FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Service role full access
GRANT ALL ON public.conversation_alerts TO service_role;
GRANT ALL ON public.conversation_alerts TO anon;

-- Enable realtime so admin dashboard gets live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_alerts;

NOTIFY pgrst, 'reload schema';
