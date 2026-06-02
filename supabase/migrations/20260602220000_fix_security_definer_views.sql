-- ============================================================================
-- Fix: Convert implicitly SECURITY DEFINER views to SECURITY INVOKER
-- ============================================================================
-- Supabase linter 0010_security_definer_view flags views without 
-- security_invoker = on because they run with the privileges of the creator
-- rather than the caller, bypassing RLS.

ALTER VIEW public.ai_routing_audit SET (security_invoker = on);
ALTER VIEW public.ai_routing_intent_stats SET (security_invoker = on);
ALTER VIEW public.ai_routing_review SET (security_invoker = on);
ALTER VIEW public.active_public_events SET (security_invoker = on);
ALTER VIEW public.ai_retry_stats SET (security_invoker = on);
