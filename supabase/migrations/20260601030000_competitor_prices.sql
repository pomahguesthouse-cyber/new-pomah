-- ============================================================
-- Competitor price tracking: per-fetch snapshots so the Pricing
-- Agent (and admins) can compare against other hotels in Semarang.
-- Each scrape inserts a fresh row; existing rows are preserved as
-- history for trend analysis.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competitor_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name      TEXT NOT NULL,
  room_type       TEXT,
  price_min       NUMERIC(12, 2),
  price_max       NUMERIC(12, 2),
  currency        TEXT NOT NULL DEFAULT 'IDR',
  star_rating     SMALLINT,
  source_url      TEXT,
  source_provider TEXT,            -- 'tavily' | 'serper' | 'manual'
  city            TEXT NOT NULL DEFAULT 'Semarang',
  notes           TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_hotel ON public.competitor_prices(lower(hotel_name));
CREATE INDEX IF NOT EXISTS idx_competitor_prices_fetched ON public.competitor_prices(fetched_at DESC);

ALTER TABLE public.competitor_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage competitor_prices" ON public.competitor_prices;
CREATE POLICY "Staff manage competitor_prices"
  ON public.competitor_prices FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
