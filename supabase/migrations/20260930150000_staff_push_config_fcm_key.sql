-- send-staff-push can read its secrets from the database when the function
-- env vars (PUSH_WEBHOOK_SECRET, FCM_SERVICE_ACCOUNT_JSON) are not set.
-- webhook_secret keeps its meaning: enqueue_staff_push() reads it to sign the
-- pg_net call. Do not put any secret value in this file.

ALTER TABLE public.staff_push_config
  ADD COLUMN IF NOT EXISTS fcm_service_account jsonb;

COMMENT ON COLUMN public.staff_push_config.fcm_service_account IS
  'Firebase service account JSON (project_id, client_email, private_key). Holds a PRIVATE KEY: service role only, never expose to anon/authenticated, never commit.';

-- Service role only: RLS on, no policies, no grants for client roles.
ALTER TABLE public.staff_push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_push_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.staff_push_config TO service_role;
