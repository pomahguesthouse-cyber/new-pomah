-- Audit log for properties.custom_google_* mutations.
--
-- Every time save_custom_google_reviews tool writes, it inserts a row here
-- with a full snapshot of the BEFORE state. Lets the manager restore an
-- accidentally-overwritten review set with restore_custom_google_reviews.
--
-- We only audit this one column group for now — full property auditing
-- would be overkill. Append-only; never updated or deleted by the app
-- (admin can prune manually if the table grows).

CREATE TABLE IF NOT EXISTS public.custom_google_reviews_audit (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- "before_save" snapshot of the three custom_google_* columns
  -- prior to the write that produced this audit row.
  prev_rating  numeric(3,2),
  prev_total   integer,
  prev_reviews jsonb,
  -- "after_save" snapshot for cross-checking what was about to land.
  next_rating  numeric(3,2),
  next_total   integer,
  next_reviews jsonb,
  -- Mode the tool was called in: 'append' or 'replace'.
  mode         text        NOT NULL CHECK (mode IN ('append','replace')),
  -- Who triggered it (manager name from agent ctx, or "system" fallback).
  actor        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_google_reviews_audit_property_idx
  ON public.custom_google_reviews_audit (property_id, created_at DESC);

-- Service role inserts directly. No RLS policies — the app uses
-- service-role for both write and read via the tools layer.
ALTER TABLE public.custom_google_reviews_audit ENABLE ROW LEVEL SECURITY;
