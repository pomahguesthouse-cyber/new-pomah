-- Manual SQL for manager WhatsApp chat audit + pending confirmation.
-- JANGAN diterapkan otomatis. Backup dulu, review, baru jalankan di Lovable
-- query_database pada project dfd1db42-3838-4443-9a62-39f8c2588d38.
-- Kode tetap jalan tanpa tabel ini (audit & pending fallback ke memori proses).

-- ── 0) Backup (jalankan terpisah, simpan hasilnya) ──────────────────────────
-- SELECT * FROM public.property_managers;
-- SELECT count(*) FROM public.manager_test_modes;

-- ── 1) Forward ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manager_chat_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_phone TEXT NOT NULL,
  actor_role TEXT,
  actor_id UUID,
  tool_name TEXT NOT NULL,
  command TEXT,
  args_summary JSONB,
  before_summary JSONB,
  after_summary JSONB,
  result TEXT NOT NULL,
  error TEXT,
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS manager_chat_audit_created_at_idx
  ON public.manager_chat_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS manager_chat_audit_actor_phone_idx
  ON public.manager_chat_audit (actor_phone, created_at DESC);

ALTER TABLE public.manager_chat_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view manager chat audit"
  ON public.manager_chat_audit;
CREATE POLICY "Authenticated users can view manager chat audit"
  ON public.manager_chat_audit
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.manager_chat_audit FROM authenticated;
GRANT SELECT ON public.manager_chat_audit TO authenticated;
GRANT ALL ON public.manager_chat_audit TO service_role;

CREATE TABLE IF NOT EXISTS public.manager_chat_pending (
  phone TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview TEXT,
  fingerprint TEXT,
  write_idempotency_key TEXT,
  command TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

ALTER TABLE public.manager_chat_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_chat_pending FROM authenticated;
GRANT ALL ON public.manager_chat_pending TO service_role;

-- ── 2) Rollback ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.manager_chat_pending;
-- DROP TABLE IF EXISTS public.manager_chat_audit;
