-- Saves the tools actually called during an auto-reply into ai_analysis.
-- Merges into existing ai_analysis so classify metadata is preserved.
CREATE OR REPLACE FUNCTION public.update_thread_autoreply_meta(
  p_thread_id  uuid,
  p_tools_used text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_threads
  SET ai_analysis = COALESCE(ai_analysis, '{}'::jsonb)
                    || jsonb_build_object(
                         'tools_used',      to_jsonb(p_tools_used),
                         'last_reply_at',   now()
                       )
  WHERE id = p_thread_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_thread_autoreply_meta TO anon;
