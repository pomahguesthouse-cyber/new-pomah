
-- ============================================================
-- Security hardening migration
-- ============================================================

-- 1) Properties: restrict SELECT to staff only.
--    Public-facing server code switches to the service-role client.
DROP POLICY IF EXISTS "anyone read properties" ON public.properties;
CREATE POLICY "staff read properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

-- 2) explore_items: writes restricted to staff.
DROP POLICY IF EXISTS "Authenticated can delete explore items" ON public.explore_items;
DROP POLICY IF EXISTS "Authenticated can insert explore items" ON public.explore_items;
DROP POLICY IF EXISTS "Authenticated can update explore items" ON public.explore_items;
DROP POLICY IF EXISTS "Authenticated can view all explore items" ON public.explore_items;
CREATE POLICY "Staff can insert explore items" ON public.explore_items
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can update explore items" ON public.explore_items
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can delete explore items" ON public.explore_items
  FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can view all explore items" ON public.explore_items
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 3) property_managers: only staff manage.
DROP POLICY IF EXISTS "Authenticated users can manage property managers" ON public.property_managers;
DROP POLICY IF EXISTS "Authenticated users can view property managers" ON public.property_managers;
CREATE POLICY "Staff can view property managers" ON public.property_managers
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can manage property managers" ON public.property_managers
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 4) sop_chunks: staff-only.
DROP POLICY IF EXISTS "Enable read access for authenticated users on sop_chunks" ON public.sop_chunks;
DROP POLICY IF EXISTS "Enable write access for authenticated users on sop_chunks" ON public.sop_chunks;
CREATE POLICY "Staff can read sop_chunks" ON public.sop_chunks
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can write sop_chunks" ON public.sop_chunks
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 5) wa_booking_states: remove public-role policy. Service role bypasses RLS.
DROP POLICY IF EXISTS "Enable all access for service role on wa_booking_states" ON public.wa_booking_states;
CREATE POLICY "Staff can manage wa_booking_states" ON public.wa_booking_states
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 6) Enable RLS on previously unprotected tables.
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage media folders" ON public.media_folders
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.seo_landing_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published landing pages" ON public.seo_landing_pages
  FOR SELECT TO anon, authenticated USING (COALESCE((to_jsonb(seo_landing_pages.*)->>'is_published')::boolean, true) = true);
CREATE POLICY "Staff manage landing pages" ON public.seo_landing_pages
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.wa_conversation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read wa_conversation_queue" ON public.wa_conversation_queue
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

ALTER TABLE public.wa_message_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read wa_message_queue" ON public.wa_message_queue
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

ALTER TABLE public.wa_processing_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read wa_processing_queue" ON public.wa_processing_queue
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 7) Storage: sop-documents private; drop public read.
UPDATE storage.buckets SET public = false WHERE id = 'sop-documents';
DROP POLICY IF EXISTS "Public read sop-documents" ON storage.objects;

-- 8) Storage: room-images writes restricted to staff.
DROP POLICY IF EXISTS "room-images staff insert" ON storage.objects;
DROP POLICY IF EXISTS "room-images staff update" ON storage.objects;
DROP POLICY IF EXISTS "room-images staff delete" ON storage.objects;
CREATE POLICY "room-images staff insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'room-images' AND public.is_staff(auth.uid()));
CREATE POLICY "room-images staff update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'room-images' AND public.is_staff(auth.uid())) WITH CHECK (bucket_id = 'room-images' AND public.is_staff(auth.uid()));
CREATE POLICY "room-images staff delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'room-images' AND public.is_staff(auth.uid()));

-- 9) Recreate stats views with security_invoker so they honour the caller's RLS.
DROP VIEW IF EXISTS public.wa_queue_stats;
CREATE VIEW public.wa_queue_stats WITH (security_invoker=on) AS
  SELECT date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text)) AS hour_wib,
     count(*) AS total_bursts,
     count(*) FILTER (WHERE (status = 'sent'::text)) AS sent,
     count(*) FILTER (WHERE (status = 'failed'::text)) AS failed,
     count(*) FILTER (WHERE (status = 'retrying'::text)) AS retrying,
     count(*) FILTER (WHERE (status = 'processing'::text)) AS processing,
     count(*) FILTER (WHERE (status = ANY (ARRAY['pending'::text, 'waiting'::text]))) AS queued,
     round(avg(message_count) FILTER (WHERE (status = 'sent'::text)), 1) AS avg_msgs_per_burst,
     (round(avg((EXTRACT(epoch FROM (completed_at - first_message_at)) * (1000)::numeric)) FILTER (WHERE (status = 'sent'::text))))::integer AS avg_total_response_ms,
     (round(avg((EXTRACT(epoch FROM (started_at - first_message_at)) * (1000)::numeric)) FILTER (WHERE (status = 'sent'::text))))::integer AS avg_delay_ms
    FROM public.wa_conversation_queue
   WHERE (created_at >= (((now() AT TIME ZONE 'Asia/Jakarta'::text))::date AT TIME ZONE 'Asia/Jakarta'::text))
   GROUP BY (date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text)))
   ORDER BY (date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text))) DESC;

DROP VIEW IF EXISTS public.wa_queue_stats_today;
CREATE VIEW public.wa_queue_stats_today WITH (security_invoker=on) AS
  SELECT date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text)) AS hour_wib,
     count(*) AS total,
     count(*) FILTER (WHERE (status = 'done'::text)) AS replied,
     count(*) FILTER (WHERE (status = 'superseded'::text)) AS superseded,
     count(*) FILTER (WHERE (status = 'pending'::text)) AS still_pending,
     (round(avg(delay_ms) FILTER (WHERE (status = ANY (ARRAY['done'::text, 'superseded'::text])))))::integer AS avg_delay_ms
    FROM public.wa_message_queue
   WHERE (created_at >= (((now() AT TIME ZONE 'Asia/Jakarta'::text))::date AT TIME ZONE 'Asia/Jakarta'::text))
   GROUP BY (date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text)))
   ORDER BY (date_trunc('hour'::text, (created_at AT TIME ZONE 'Asia/Jakarta'::text))) DESC;

-- 10) Pin search_path on all custom SECURITY DEFINER / trigger functions.
ALTER FUNCTION public.bookings_ensure_reference_code() SET search_path = public;
ALTER FUNCTION public.claim_queue_winner(text, uuid, text, integer, uuid) SET search_path = public;
ALTER FUNCTION public.enqueue_processing_job(text, uuid, text) SET search_path = public;
ALTER FUNCTION public.generate_booking_reference() SET search_path = public;
ALTER FUNCTION public.get_active_booking_state(text) SET search_path = public;
ALTER FUNCTION public.get_autoreply_context(text) SET search_path = public;
ALTER FUNCTION public.is_newest_pending_for_phone(uuid, text) SET search_path = public;
ALTER FUNCTION public.is_still_winner(uuid) SET search_path = public;
ALTER FUNCTION public.mark_queue_done(uuid) SET search_path = public;
ALTER FUNCTION public.trigger_process_wa_queue() SET search_path = public;
ALTER FUNCTION public.update_booking_state(text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.update_seo_landing_page_updated_at() SET search_path = public;
ALTER FUNCTION public.update_wa_booking_states_updated_at() SET search_path = public;
ALTER FUNCTION public.wa_queue_claim(uuid, text) SET search_path = public;
ALTER FUNCTION public.wa_queue_claim_retry(uuid, text) SET search_path = public;
ALTER FUNCTION public.wa_queue_cleanup_zombies() SET search_path = public;
ALTER FUNCTION public.wa_queue_complete(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.wa_queue_fail(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.wa_queue_get_retrying(text) SET search_path = public;
ALTER FUNCTION public.wa_queue_heartbeat(uuid, text) SET search_path = public;
ALTER FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) SET search_path = public;

-- 11) Revoke EXECUTE on SECURITY DEFINER RPCs from anon/authenticated (server-side only).
REVOKE EXECUTE ON FUNCTION public.claim_queue_winner(text, uuid, text, integer, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_processing_job(text, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_booking_state(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_autoreply_context(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_newest_pending_for_phone(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_still_winner(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_queue_done(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_message_metadata(uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_outbound_whatsapp(uuid, text, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_booking_state(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_thread_autoreply_meta(uuid, text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_claim(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_claim_retry(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_cleanup_zombies() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_complete(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_fail(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_get_retrying(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_heartbeat(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_process_wa_queue() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_webchat_message(uuid, text, text, jsonb) FROM anon, authenticated;
