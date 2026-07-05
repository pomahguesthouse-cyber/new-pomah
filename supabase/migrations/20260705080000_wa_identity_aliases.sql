-- ============================================================
-- WhatsApp Identity Aliases: phone / LID / JID canonicalization
-- ============================================================
-- Goal:
--   1. Treat 08xxx, 62xxx, JID, and WhatsApp LID as one identity.
--   2. Prevent manager / guest routing from splitting when WPPConnect sends LID.
--   3. Keep conversation context in one canonical thread.
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_wa_identity(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text;
BEGIN
  v := lower(coalesce(p_raw, ''));
  v := btrim(v);
  IF v = '' THEN
    RETURN NULL;
  END IF;

  -- Strip common WhatsApp/Jabber suffixes first, then keep digits/+ only.
  v := regexp_replace(v, '@(c|s)\.whatsapp\.net$', '', 'i');
  v := regexp_replace(v, '@lid$', '', 'i');
  v := regexp_replace(v, '@.*$', '', 'i');
  v := regexp_replace(v, '[^0-9+]', '', 'g');
  v := regexp_replace(v, '^\+', '');

  -- Indonesian public phone normalization.
  IF v LIKE '620%' THEN
    v := '62' || substr(v, 4);
  ELSIF v LIKE '0%' THEN
    v := '62' || substr(v, 2);
  ELSIF v ~ '^8[0-9]{7,14}$' THEN
    v := '62' || v;
  END IF;

  RETURN NULLIF(v, '');
END;
$$;

CREATE TABLE IF NOT EXISTS public.wa_identity_aliases (
  alias_value     text PRIMARY KEY,
  canonical_phone text NOT NULL,
  alias_type      text NOT NULL DEFAULT 'unknown'
                  CHECK (alias_type IN ('phone', 'jid', 'lid', 'unknown')),
  role            text NOT NULL DEFAULT 'unknown'
                  CHECK (role IN ('guest', 'manager', 'unknown')),
  display_name    text,
  is_active       boolean NOT NULL DEFAULT true,
  source          text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (alias_value <> ''),
  CHECK (canonical_phone <> '')
);

CREATE INDEX IF NOT EXISTS idx_wa_identity_aliases_canonical
  ON public.wa_identity_aliases (canonical_phone)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_wa_identity_aliases_role
  ON public.wa_identity_aliases (role, canonical_phone)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.upsert_wa_identity_alias(
  p_canonical_phone text,
  p_alias_value     text,
  p_alias_type      text DEFAULT 'unknown',
  p_role            text DEFAULT 'unknown',
  p_display_name    text DEFAULT NULL,
  p_source          text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canonical text := public.normalize_wa_identity(coalesce(p_canonical_phone, p_alias_value));
  v_alias     text := public.normalize_wa_identity(p_alias_value);
  v_type      text := coalesce(nullif(p_alias_type, ''), 'unknown');
  v_role      text := coalesce(nullif(p_role, ''), 'unknown');
BEGIN
  IF v_canonical IS NULL OR v_alias IS NULL THEN
    RETURN v_canonical;
  END IF;

  IF v_type NOT IN ('phone', 'jid', 'lid', 'unknown') THEN
    v_type := 'unknown';
  END IF;
  IF v_role NOT IN ('guest', 'manager', 'unknown') THEN
    v_role := 'unknown';
  END IF;

  INSERT INTO public.wa_identity_aliases (
    alias_value,
    canonical_phone,
    alias_type,
    role,
    display_name,
    source,
    metadata,
    is_active,
    last_seen_at,
    updated_at
  ) VALUES (
    v_alias,
    v_canonical,
    v_type,
    v_role,
    nullif(p_display_name, ''),
    nullif(p_source, ''),
    coalesce(p_metadata, '{}'::jsonb),
    true,
    now(),
    now()
  )
  ON CONFLICT (alias_value)
  DO UPDATE SET
    canonical_phone = EXCLUDED.canonical_phone,
    alias_type      = CASE WHEN EXCLUDED.alias_type <> 'unknown' THEN EXCLUDED.alias_type ELSE public.wa_identity_aliases.alias_type END,
    role            = CASE WHEN EXCLUDED.role <> 'unknown' THEN EXCLUDED.role ELSE public.wa_identity_aliases.role END,
    display_name    = COALESCE(EXCLUDED.display_name, public.wa_identity_aliases.display_name),
    source          = COALESCE(EXCLUDED.source, public.wa_identity_aliases.source),
    metadata        = public.wa_identity_aliases.metadata || EXCLUDED.metadata,
    is_active       = true,
    last_seen_at    = now(),
    updated_at      = now();

  RETURN v_canonical;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_wa_canonical_phone(p_identity text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_identity  text := public.normalize_wa_identity(p_identity);
  v_canonical text;
BEGIN
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.canonical_phone
    INTO v_canonical
  FROM public.wa_identity_aliases a
  WHERE a.alias_value = v_identity
    AND a.is_active = true
  LIMIT 1;

  RETURN COALESCE(v_canonical, v_identity);
END;
$$;

-- ------------------------------------------------------------
-- Seed primary Pomah manager aliases.
-- ------------------------------------------------------------
SELECT public.upsert_wa_identity_alias('6282226749990', '6282226749990', 'phone', 'manager', 'Manager Pomah', 'seed', '{"note":"primary manager phone"}'::jsonb);
SELECT public.upsert_wa_identity_alias('6282226749990', '082226749990',   'phone', 'manager', 'Manager Pomah', 'seed', '{"note":"local phone format"}'::jsonb);
SELECT public.upsert_wa_identity_alias('6282226749990', '254932179501279', 'lid',  'manager', 'Manager Pomah', 'observed_wppconnect', '{"note":"observed WPPConnect LID alias"}'::jsonb);
SELECT public.upsert_wa_identity_alias('6282226749990', '254932179501279@lid', 'lid', 'manager', 'Manager Pomah', 'observed_wppconnect', '{"note":"observed WPPConnect LID alias with suffix"}'::jsonb);

-- Keep the existing manager table compatible with the old TypeScript resolver.
ALTER TABLE public.property_managers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

WITH target_properties AS (
  SELECT id FROM public.properties
)
INSERT INTO public.property_managers (property_id, name, phone, role, is_active)
SELECT id, 'Manager Pomah', '6282226749990', 'super_admin', true FROM target_properties
ON CONFLICT (property_id, phone)
DO UPDATE SET name = EXCLUDED.name, role = 'super_admin', is_active = true;

WITH target_properties AS (
  SELECT id FROM public.properties
)
INSERT INTO public.property_managers (property_id, name, phone, role, is_active)
SELECT id, 'Manager Pomah', '254932179501279', 'super_admin', true FROM target_properties
ON CONFLICT (property_id, phone)
DO UPDATE SET name = EXCLUDED.name, role = 'super_admin', is_active = true;

INSERT INTO public.manager_test_modes (phone, guest_mode, updated_at)
VALUES
  ('6282226749990', false, now()),
  ('082226749990', false, now()),
  ('254932179501279', false, now())
ON CONFLICT (phone)
DO UPDATE SET guest_mode = false, updated_at = now();

-- ------------------------------------------------------------
-- Merge already-split manager threads: public phone + LID.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_keep_thread uuid;
  v_canonical   text := '6282226749990';
BEGIN
  SELECT id INTO v_keep_thread
  FROM public.whatsapp_threads
  WHERE public.resolve_wa_canonical_phone(phone) = v_canonical
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_keep_thread IS NOT NULL THEN
    UPDATE public.whatsapp_messages
    SET thread_id = v_keep_thread
    WHERE thread_id IN (
      SELECT id FROM public.whatsapp_threads
      WHERE public.resolve_wa_canonical_phone(phone) = v_canonical
        AND id <> v_keep_thread
    );

    IF to_regclass('public.conversation_alerts') IS NOT NULL THEN
      UPDATE public.conversation_alerts
      SET thread_id = v_keep_thread,
          phone = v_canonical
      WHERE public.resolve_wa_canonical_phone(phone) = v_canonical;
    END IF;

    IF to_regclass('public.ai_retry_audit') IS NOT NULL THEN
      UPDATE public.ai_retry_audit
      SET thread_id = v_keep_thread,
          phone = v_canonical
      WHERE public.resolve_wa_canonical_phone(phone) = v_canonical;
    END IF;

    IF to_regclass('public.wa_conversation_queue') IS NOT NULL THEN
      UPDATE public.wa_conversation_queue
      SET thread_id = v_keep_thread,
          phone = v_canonical
      WHERE public.resolve_wa_canonical_phone(phone) = v_canonical;
    END IF;

    DELETE FROM public.whatsapp_threads
    WHERE public.resolve_wa_canonical_phone(phone) = v_canonical
      AND id <> v_keep_thread;

    UPDATE public.whatsapp_threads t
    SET phone = v_canonical,
        display_name = COALESCE(NULLIF(t.display_name, ''), 'Manager Pomah'),
        last_message_at = COALESCE((
          SELECT max(m.sent_at) FROM public.whatsapp_messages m WHERE m.thread_id = v_keep_thread
        ), t.last_message_at),
        last_message_preview = COALESCE((
          SELECT left(m.body, 120)
          FROM public.whatsapp_messages m
          WHERE m.thread_id = v_keep_thread
          ORDER BY m.sent_at DESC
          LIMIT 1
        ), t.last_message_preview)
    WHERE t.id = v_keep_thread;
  END IF;
END $$;

-- Canonicalize active queue identities where aliases are known.
UPDATE public.wa_conversation_queue q
SET phone = public.resolve_wa_canonical_phone(q.phone)
WHERE public.resolve_wa_canonical_phone(q.phone) IS DISTINCT FROM q.phone;

-- ------------------------------------------------------------
-- Canonical-aware receive_whatsapp_message.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text, text, text, text);
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone  text,
  p_name   text,
  p_body   text,
  p_wpp_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone      text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id  uuid;
  v_message_id uuid;
  v_wpp_id     text := NULLIF(btrim(p_wpp_id), '');
BEGIN
  IF v_phone IS NULL THEN
    v_phone := public.normalize_wa_identity(p_phone);
  END IF;

  IF v_wpp_id IS NOT NULL THEN
    SELECT id INTO v_message_id
    FROM public.whatsapp_messages
    WHERE wpp_id = v_wpp_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RETURN v_message_id;
    END IF;
  END IF;

  -- Store the observed identity as an alias to itself unless a stronger mapping
  -- already exists. This makes future lookups stable for JID/LID-only contacts.
  PERFORM public.upsert_wa_identity_alias(v_phone, p_phone, 'unknown', 'unknown', p_name, 'receive_whatsapp_message', '{}'::jsonb);

  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (phone, display_name, status, unread_count)
    VALUES (v_phone, p_name, 'open', 0)
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.whatsapp_messages (thread_id, direction, body, wpp_id)
  VALUES (v_thread_id, 'in', p_body, v_wpp_id)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    display_name         = COALESCE(NULLIF(p_name, ''), display_name),
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;

  RETURN v_message_id;
END;
$$;

-- Keep the 3-arg signature working for old callers.
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name  text,
  p_body  text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.receive_whatsapp_message(p_phone, p_name, p_body, NULL::text);
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Canonical-aware get_autoreply_context.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone                   text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id               uuid;
  v_ai_auto                 boolean := true;
  v_auto_reply              boolean := false;
  v_wpp_token               text    := '';
  v_ai_lab_config           jsonb   := '{}';
  v_smart_delay_cfg         jsonb   := NULL;
  v_chat_summary            text    := '';
  v_chat_summary_json       jsonb   := '{}'::jsonb;
  v_chat_summary_version    integer := 1;
  v_chat_summary_updated_at timestamptz;
  v_messages                jsonb   := '[]';
BEGIN
  SELECT id, ai_auto,
         COALESCE(chat_summary, ''),
         COALESCE(chat_summary_json, '{}'::jsonb),
         COALESCE(chat_summary_version, 1),
         chat_summary_updated_at
    INTO v_thread_id, v_ai_auto,
         v_chat_summary, v_chat_summary_json,
         v_chat_summary_version, v_chat_summary_updated_at
  FROM public.whatsapp_threads
  WHERE phone = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(wpp_token, ''),
         COALESCE(ai_lab_config, '{}'),
         smart_delay_config
    INTO v_wpp_token, v_ai_lab_config, v_smart_delay_cfg
  FROM public.properties
  LIMIT 1;

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  ) AND v_ai_auto;

  SELECT jsonb_agg(
           jsonb_build_object('direction', direction, 'body', body, 'sent_at', sent_at)
           ORDER BY sent_at ASC
         )
    INTO v_messages
  FROM (
    SELECT direction, body, sent_at
    FROM   public.whatsapp_messages
    WHERE  thread_id = v_thread_id
    ORDER  BY sent_at DESC
    LIMIT  30
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',               v_thread_id,
    'phone',                   v_phone,
    'canonical_phone',         v_phone,
    'auto_reply_enabled',      v_auto_reply,
    'wpp_token',               v_wpp_token,
    'messages',                COALESCE(v_messages, '[]'::jsonb),
    'smart_delay_config',      v_smart_delay_cfg,
    'chat_summary',            v_chat_summary,
    'chat_summary_json',       v_chat_summary_json,
    'chat_summary_version',    v_chat_summary_version,
    'chat_summary_updated_at', v_chat_summary_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Canonical-aware queue upsert.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_queue_upsert(
  p_phone         text,
  p_thread_id     uuid,
  p_message_id    uuid,
  p_body          text,
  p_delay_ms      integer,
  p_max_wait_ms   integer
)
RETURNS TABLE(
  entry_id     uuid,
  sleep_ms     integer,
  is_new_burst boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone              text := public.resolve_wa_canonical_phone(p_phone);
  v_existing_id        uuid;
  v_max_wait_until     timestamptz;
  v_new_process_after  timestamptz;
  v_sleep_ms           integer;
BEGIN
  SELECT q.id, q.max_wait_until
  INTO   v_existing_id, v_max_wait_until
  FROM   public.wa_conversation_queue q
  WHERE  q.phone = v_phone
    AND  q.status IN ('pending', 'waiting')
  ORDER  BY q.created_at DESC
  LIMIT  1
  FOR UPDATE SKIP LOCKED;

  IF v_existing_id IS NOT NULL THEN
    v_new_process_after := LEAST(
      now() + make_interval(secs => p_delay_ms::float / 1000.0),
      v_max_wait_until
    );

    UPDATE public.wa_conversation_queue
    SET
      status            = 'waiting',
      process_after     = v_new_process_after,
      last_message_body = p_body,
      last_message_id   = p_message_id,
      message_count     = message_count + 1,
      updated_at        = now()
    WHERE id = v_existing_id;

    v_sleep_ms := GREATEST(0,
      EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000
    )::integer;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, false;
  ELSE
    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until    := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);

    INSERT INTO public.wa_conversation_queue (
      phone, thread_id, last_message_id, last_message_body,
      process_after, max_wait_until, status, message_count
    ) VALUES (
      v_phone, p_thread_id, p_message_id, p_body,
      v_new_process_after, v_max_wait_until, 'pending', 1
    )
    RETURNING id INTO v_existing_id;

    v_sleep_ms := p_delay_ms;
    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_identity_aliases TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.wa_identity_aliases TO anon;
GRANT EXECUTE ON FUNCTION public.normalize_wa_identity(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_wa_canonical_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_wa_identity_alias(text, text, text, text, text, text, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
