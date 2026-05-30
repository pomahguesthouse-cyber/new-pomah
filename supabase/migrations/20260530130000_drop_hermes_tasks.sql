-- ============================================================
-- Drop Hermes Agent table + helpers
-- ============================================================
--
-- Reverts 20260530120000_create_hermes_tasks.sql for databases
-- that already applied it. The Hermes integration was abandoned;
-- this migration cleans up the leftover table, trigger, and helper
-- function so the schema returns to its prior state.
--
-- Safe to run on databases that never had hermes_tasks: every
-- DROP uses IF EXISTS.
-- ============================================================

DROP TRIGGER  IF EXISTS hermes_tasks_touch_updated_at ON public.hermes_tasks;
DROP TABLE    IF EXISTS public.hermes_tasks;
DROP FUNCTION IF EXISTS public.hermes_tasks_touch_updated_at();
