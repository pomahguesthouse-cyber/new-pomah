-- Webchat conversation logging.
-- The public AI webchat runs as the anon role, which cannot write to
-- ai_conversation_logs (staff-only RLS). A SECURITY DEFINER function
-- lets it append a log row without opening the table to anon.

-- Tag where a log row came from (e.g. 'webchat'); existing rows stay null.
alter table public.ai_conversation_logs
  add column if not exists source text;

create or replace function public.log_webchat_message(
  p_thread_id uuid,
  p_user_message text,
  p_ai_response text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_conversation_logs (thread_id, user_message, ai_response, source)
  values (p_thread_id, p_user_message, p_ai_response, 'webchat');
$$;

grant execute on function public.log_webchat_message(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
