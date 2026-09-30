-- Add the manager role in its own migration.
-- PostgreSQL cannot use a new enum value in the same transaction that adds it.
-- The follow-up file updates is_staff() and the push recipient filter.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
