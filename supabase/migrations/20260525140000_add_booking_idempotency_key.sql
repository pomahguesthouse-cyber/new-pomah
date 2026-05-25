-- Idempotency for create_booking under webhook retries.
--
-- The webhook retries the whole orchestration up to 3x. If a booking was
-- already created in a prior attempt (e.g. the closing LLM call timed out),
-- a naive retry would create a duplicate guest + booking. This column lets
-- create_booking detect and return the existing booking instead.
--
-- The key is derived from the inbound message (phone + message id), so it is
-- stable across retries of the same message but unique per new message.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique index: enforce uniqueness only when a key is present, so
-- existing/manual bookings with NULL keys are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_uidx
  ON public.bookings (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
