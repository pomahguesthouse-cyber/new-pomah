-- Ensure service_role can run all wa_conversation_queue RPCs (webhook uses supabaseAdmin).
GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_claim(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_claim_retry(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_heartbeat(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_complete(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_fail(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_cleanup_zombies() TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_queue_get_retrying(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_outbound_whatsapp(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_message_metadata(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_thread_autoreply_meta(uuid, text[]) TO service_role;
