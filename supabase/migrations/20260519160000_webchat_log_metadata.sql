-- Real per-exchange metadata for webchat logs: the intent (classified
-- by the LLM), confidence, and the tools the chatbot actually called.

alter table public.ai_conversation_logs
  add column if not exists metadata jsonb;

-- Replace log_webchat_message with a 4-arg version that also stores
-- metadata. p_metadata has a default so existing 3-arg callers still work.
drop function if exists public.log_webchat_message(uuid, text, text);

create or replace function public.log_webchat_message(
  p_thread_id uuid,
  p_user_message text,
  p_ai_response text,
  p_metadata jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_conversation_logs
    (thread_id, user_message, ai_response, source, metadata)
  values
    (p_thread_id, p_user_message, p_ai_response, 'webchat', p_metadata);
$$;

grant execute on function public.log_webchat_message(uuid, text, text, jsonb)
  to anon, authenticated;

notify pgrst, 'reload schema';
