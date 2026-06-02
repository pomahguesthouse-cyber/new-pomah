-- Extend booking_source enum with 'manager_chat' for bookings created by a
-- property manager via the per-agent Telegram bot or the WA managerial path.
-- Lets reporting distinguish staff-entered bookings from guest channels.

ALTER TYPE public.booking_source ADD VALUE IF NOT EXISTS 'manager_chat';
