DROP POLICY IF EXISTS "anon read booking_rooms" ON public.booking_rooms;
DROP POLICY IF EXISTS "anon add booking_rooms" ON public.booking_rooms;

DROP POLICY IF EXISTS schedules_all_authenticated ON public.seo_article_schedules;
CREATE POLICY "staff manage seo_article_schedules"
  ON public.seo_article_schedules FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS articles_all_authenticated ON public.seo_generated_articles;
CREATE POLICY "staff manage seo_generated_articles"
  ON public.seo_generated_articles FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "sop-documents staff read"   ON storage.objects;
DROP POLICY IF EXISTS "sop-documents staff insert" ON storage.objects;
DROP POLICY IF EXISTS "sop-documents staff delete" ON storage.objects;

CREATE POLICY "sop-documents staff read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sop-documents' AND public.is_staff(auth.uid()));

CREATE POLICY "sop-documents staff insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sop-documents' AND public.is_staff(auth.uid()));

CREATE POLICY "sop-documents staff delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sop-documents' AND public.is_staff(auth.uid()));

ALTER FUNCTION public.match_sop_chunks(vector, double precision, integer) SET search_path = public;
ALTER FUNCTION public.seo_article_schedules_touch_updated_at() SET search_path = public;

ALTER VIEW public.ai_routing_audit         SET (security_invoker = on);
ALTER VIEW public.ai_routing_intent_stats  SET (security_invoker = on);
ALTER VIEW public.ai_routing_review        SET (security_invoker = on);
ALTER VIEW public.active_public_events     SET (security_invoker = on);

REVOKE EXECUTE ON FUNCTION public.wa_queue_claim_next(text) FROM anon, authenticated;