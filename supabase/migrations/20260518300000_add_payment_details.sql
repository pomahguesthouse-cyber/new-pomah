-- Bank transfer details shown to guests after a booking is created
-- (e.g. by the AI chatbot's conversational booking flow).
alter table public.properties
  add column if not exists payment_bank_name text,
  add column if not exists payment_account_number text,
  add column if not exists payment_account_holder text;

notify pgrst, 'reload schema';
