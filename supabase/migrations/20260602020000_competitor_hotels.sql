-- Curated competitor list for the Pricing Agent's scrape.
--
-- Admin maintains an array of hotel names (e.g. ['INARA BY KIYANA',
-- 'Pomah Guesthouse', 'Hotel ABC Semarang']). The scrape tool iterates
-- this list, querying OTAs per hotel, and rejects junk results that
-- don't reference any configured competitor.
--
-- Empty array → tool falls back to a heuristic free-text query that
-- still filters aggregator landing pages.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS competitor_hotels jsonb NOT NULL DEFAULT '[]'::jsonb;
