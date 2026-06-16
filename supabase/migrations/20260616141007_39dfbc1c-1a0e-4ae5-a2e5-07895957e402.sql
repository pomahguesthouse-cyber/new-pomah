
ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_event_type_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'new_booking','payment_proof','complaint','new_session','bot_loop',
    'zombie_timeout','booking_stuck','rpc_failure'
  ]));

CREATE TABLE IF NOT EXISTS public.rpc_failure_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rpc_name      text NOT NULL,
  error_message text,
  context       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rpc_failure_events TO service_role;

ALTER TABLE public.rpc_failure_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages rpc failure events"
  ON public.rpc_failure_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS rpc_failure_events_rpc_time_idx
  ON public.rpc_failure_events (rpc_name, created_at DESC);
