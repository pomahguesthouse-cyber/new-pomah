
-- Fix search_path on trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Revoke direct execute on SECURITY DEFINER helpers; they're called from policies/triggers only
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Tighten "anyone create guest" — require a name
DROP POLICY IF EXISTS "anyone create guest" ON public.guests;
CREATE POLICY "anyone create guest" ON public.guests FOR INSERT TO anon, authenticated
  WITH CHECK (length(coalesce(full_name, '')) > 0);
