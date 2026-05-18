-- LLM credentials for the AI webchat. OpenAI-compatible: an API key, an
-- optional base URL (default api.openai.com) and a model name.
alter table public.properties
  add column if not exists ai_api_key text,
  add column if not exists ai_base_url text,
  add column if not exists ai_model text;

notify pgrst, 'reload schema';
