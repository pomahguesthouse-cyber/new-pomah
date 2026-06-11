
-- Security hardening: tighten RLS on staff-sensitive tables

-- 1. ai_retry_audit: previously any authenticated user could SELECT guest phones.
DROP POLICY IF EXISTS "authenticated read retry audit" ON public.ai_retry_audit;
CREATE POLICY "staff read retry audit"
  ON public.ai_retry_audit
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 2. rooms: drop overly-permissive public read policies. All client reads go via
-- supabaseAdmin server functions; staff users keep access via this policy.
DROP POLICY IF EXISTS "anon read rooms" ON public.rooms;
DROP POLICY IF EXISTS "anyone read rooms" ON public.rooms;
CREATE POLICY "staff read rooms"
  ON public.rooms
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 3. properties: API keys + payment credentials must be admin-only.
-- Admin server functions (settings page, SEO page, training) now use the
-- service-role client gated by has_role('admin'), so this lock-down is safe.
DROP POLICY IF EXISTS "staff read properties" ON public.properties;
CREATE POLICY "admin read properties"
  ON public.properties
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. sop-documents bucket: add the missing UPDATE policy so storage operations
-- have a complete set (INSERT/SELECT/UPDATE/DELETE) for staff users.
DROP POLICY IF EXISTS "sop-documents staff update" ON storage.objects;
CREATE POLICY "sop-documents staff update"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING ((bucket_id = 'sop-documents') AND public.is_staff(auth.uid()))
  WITH CHECK ((bucket_id = 'sop-documents') AND public.is_staff(auth.uid()));

-- 5. custom_google_reviews_audit: had RLS enabled but no policies (default deny).
-- Add an explicit admin-only SELECT policy so the audit log is consistently
-- documented and visible to admins via PostgREST.
CREATE POLICY "admin read review audit"
  ON public.custom_google_reviews_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
