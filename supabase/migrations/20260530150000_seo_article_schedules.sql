-- ============================================================
-- Scheduled article auto-generation + generated-article storage
-- ============================================================
--
-- Adds two tables:
--   * seo_article_schedules   — recurring jobs (daily/weekly/monthly + jam)
--   * seo_generated_articles  — output of every run + manual generations
--
-- A pg_cron job polls /api/cron/run-article-schedules every 5 minutes.
-- That endpoint runs due schedules and also marks events whose
-- event_end_date < today as 'expired'.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Schedules ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_article_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  topic         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('pariwisata', 'event', 'destinasi')),

  -- Recurrence
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  hour          INT  NOT NULL CHECK (hour BETWEEN 0 AND 23),       -- WIB (Asia/Jakarta)
  minute        INT  NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  day_of_week   INT  CHECK (day_of_week BETWEEN 0 AND 6),          -- 0=Minggu, only for weekly
  day_of_month  INT  CHECK (day_of_month BETWEEN 1 AND 28),        -- only for monthly

  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ NOT NULL,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS seo_article_schedules_next_run_idx
  ON public.seo_article_schedules (next_run_at)
  WHERE enabled = true;

-- ── Generated articles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_generated_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  schedule_id   UUID REFERENCES public.seo_article_schedules(id) ON DELETE SET NULL,

  category      TEXT NOT NULL CHECK (category IN ('pariwisata', 'event', 'destinasi')),
  title         TEXT NOT NULL,
  topic         TEXT,
  meta_description TEXT,
  paragraphs    JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- For events: end date (date when the event finishes). Articles with
  -- event_end_date < CURRENT_DATE get status='expired' by the worker.
  event_end_date DATE,

  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'expired', 'archived'))
);

CREATE INDEX IF NOT EXISTS seo_generated_articles_created_idx
  ON public.seo_generated_articles (created_at DESC);

CREATE INDEX IF NOT EXISTS seo_generated_articles_category_status_idx
  ON public.seo_generated_articles (category, status);

-- ── updated_at trigger for schedules ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_article_schedules_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seo_article_schedules_touch ON public.seo_article_schedules;
CREATE TRIGGER seo_article_schedules_touch
  BEFORE UPDATE ON public.seo_article_schedules
  FOR EACH ROW EXECUTE FUNCTION public.seo_article_schedules_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.seo_article_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_generated_articles  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedules_all_authenticated ON public.seo_article_schedules;
CREATE POLICY schedules_all_authenticated
  ON public.seo_article_schedules
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS articles_all_authenticated ON public.seo_generated_articles;
CREATE POLICY articles_all_authenticated
  ON public.seo_generated_articles
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_article_schedules  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_generated_articles TO authenticated, service_role;

-- ── pg_cron job ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-article-schedules') THEN
    PERFORM cron.unschedule('run-article-schedules');
  END IF;

  -- Every 5 minutes
  PERFORM cron.schedule(
    'run-article-schedules',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url     := 'https://pomahguesthouse.com/api/cron/run-article-schedules',
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    $cron$
  );
END $$;
