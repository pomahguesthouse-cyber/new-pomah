-- ============================================================
-- Drop the long-unused `seasonal_rates` table.
-- ============================================================
-- Background:
--   • The table predates `room_daily_rates`. Its "multiplier × date
--     window" model was superseded by explicit per-day overrides in
--     room_daily_rates (see migration 20260604000000_create_room_daily_rates).
--   • Audit confirms no code path READS from seasonal_rates anymore:
--     - check_room_availability reads base_rate + room_daily_rates only
--     - create_booking (LLM + public widget + cart + webchat) reads
--       base_rate + room_daily_rates only
--     - No SQL function/view references the table
--   • The old /admin/pricing page was the sole writer, and it is being
--     removed in the same PR that ships this migration.
--
-- Dropping the publication membership first avoids "cannot drop table
-- that is part of publication" on some Postgres / Supabase setups.
-- ============================================================

alter publication supabase_realtime drop table if exists public.seasonal_rates;

drop table if exists public.seasonal_rates cascade;
