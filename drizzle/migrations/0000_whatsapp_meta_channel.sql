ALTER TABLE public.whatsapp_threads ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'evolution';

CREATE TABLE public.whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.whatsapp_webhook_events TO service_role;
GRANT SELECT ON public.whatsapp_webhook_events TO authenticated;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read webhook events" ON public.whatsapp_webhook_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX whatsapp_webhook_events_pending_idx ON public.whatsapp_webhook_events (next_attempt_at) WHERE processed_at IS NULL;

CREATE TABLE public.whatsapp_meta_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text UNIQUE,
  recipient text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'accepted',
  error jsonb,
  status_timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.whatsapp_meta_outbound TO service_role;
GRANT SELECT ON public.whatsapp_meta_outbound TO authenticated;
ALTER TABLE public.whatsapp_meta_outbound ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read meta outbound" ON public.whatsapp_meta_outbound
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Status diterapkan idempoten; urutan sent<delivered<read, failed selalu dicatat
CREATE OR REPLACE FUNCTION public.apply_whatsapp_meta_status(p_message_id text, p_status text, p_ts timestamptz, p_errors jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; rank_new int; rank_old int;
BEGIN
  SELECT * INTO r FROM whatsapp_meta_outbound WHERE provider_message_id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  rank_new := CASE p_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END;
  rank_old := CASE r.status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END;
  UPDATE whatsapp_meta_outbound SET
    status = CASE WHEN rank_new > rank_old THEN p_status ELSE status END,
    error = COALESCE(p_errors, error),
    status_timestamps = CASE WHEN status_timestamps ? p_status THEN status_timestamps
                             ELSE status_timestamps || jsonb_build_object(p_status, p_ts) END,
    updated_at = now()
  WHERE id = r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.apply_whatsapp_meta_status(text,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_meta_status(text,text,timestamptz,jsonb) TO service_role;