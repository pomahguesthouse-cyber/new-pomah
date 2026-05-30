-- ============================================================
-- Web search API keys for the AI Content Studio
-- ============================================================
--
-- The Content Studio's "Generate from Web Search" feature calls
-- Tavily or Serper to fetch fresh sources. Storing the API keys
-- in the properties row lets the admin edit them from the UI
-- (alternatif: tetap di env). Kosong = pakai env / disable search.
-- ============================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tavily_api_key TEXT,
  ADD COLUMN IF NOT EXISTS serper_api_key TEXT;
