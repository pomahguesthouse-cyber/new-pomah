
-- 1) booking_form_tokens: hilangkan akses anon + akses authenticated luas
DROP POLICY IF EXISTS "Anon dapat membaca token aktif" ON public.booking_form_tokens;
DROP POLICY IF EXISTS "Authenticated dapat membaca semua" ON public.booking_form_tokens;
REVOKE SELECT ON public.booking_form_tokens FROM anon;

CREATE POLICY "Staff read booking_form_tokens"
  ON public.booking_form_tokens
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

-- 2) booking_form_send_logs: batasi baca ke staf
DROP POLICY IF EXISTS "Authenticated dapat membaca semua log" ON public.booking_form_send_logs;

CREATE POLICY "Staff read booking_form_send_logs"
  ON public.booking_form_send_logs
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

-- 3) telegram_agent_bots: hanya admin
DROP POLICY IF EXISTS "Staff manage telegram_agent_bots" ON public.telegram_agent_bots;

CREATE POLICY "Admins manage telegram_agent_bots"
  ON public.telegram_agent_bots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4) property_managers: lindungi telegram_link_token dari mutasi non-admin
CREATE OR REPLACE FUNCTION public.guard_property_managers_telegram_link_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role (edge functions / server admin client) selalu boleh
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.telegram_link_token IS NOT NULL
       AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Hanya admin yang boleh mengisi telegram_link_token';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.telegram_link_token IS DISTINCT FROM OLD.telegram_link_token
       AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Hanya admin yang boleh mengubah telegram_link_token';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_property_managers_telegram_link_token
  ON public.property_managers;

CREATE TRIGGER guard_property_managers_telegram_link_token
  BEFORE INSERT OR UPDATE ON public.property_managers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_property_managers_telegram_link_token();

-- 5) handoff_tickets: staf boleh membaca (tetap admin yang ALL)
CREATE POLICY "Staff read handoff_tickets"
  ON public.handoff_tickets
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

-- 6) webchat: siapkan kolom property_id + scoping policy
ALTER TABLE public.webchat_threads
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.webchat_messages
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_webchat_threads_property_id
  ON public.webchat_threads(property_id);
CREATE INDEX IF NOT EXISTS idx_webchat_messages_property_id
  ON public.webchat_messages(property_id);

DROP POLICY IF EXISTS "staff manage webchat threads" ON public.webchat_threads;
DROP POLICY IF EXISTS "staff manage webchat messages" ON public.webchat_messages;

CREATE POLICY "staff manage webchat threads"
  ON public.webchat_threads
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (is_staff(auth.uid()) AND property_id IS NULL)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (is_staff(auth.uid()) AND property_id IS NULL)
  );

CREATE POLICY "staff manage webchat messages"
  ON public.webchat_messages
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      is_staff(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.webchat_threads t
        WHERE t.id = webchat_messages.thread_id
          AND t.property_id IS NULL
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      is_staff(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.webchat_threads t
        WHERE t.id = webchat_messages.thread_id
          AND t.property_id IS NULL
      )
    )
  );
