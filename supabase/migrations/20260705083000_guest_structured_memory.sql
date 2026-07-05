-- ============================================================
-- Guest Structured Memory
-- ============================================================
-- Stores stable, structured guest context separately from short per-thread
-- summaries. This makes the chatbot remember important booking context across
-- turns/sessions without relying only on the last 10-30 WhatsApp messages.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.guest_structured_memory (
  canonical_phone        text PRIMARY KEY,
  thread_id              uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL,
  guest_name             text,
  last_topic             text CHECK (last_topic IN ('pricing','availability','facility','booking','payment','complaint','location','general') OR last_topic IS NULL),
  room_type              text,
  check_in               date,
  check_out              date,
  guest_count            integer CHECK (guest_count IS NULL OR guest_count >= 0),
  adults                 integer CHECK (adults IS NULL OR adults >= 0),
  children               integer CHECK (children IS NULL OR children >= 0),
  booking_status         text CHECK (booking_status IN ('none','pending','confirmed','cancelled','checked_in','checked_out') OR booking_status IS NULL),
  payment_status         text CHECK (payment_status IN ('unpaid','down_payment','paid','pay_at_hotel') OR payment_status IS NULL),
  source_channel         text,
  budget_note            text,
  special_requests       text,
  preference_notes       text,
  complaint_active       boolean NOT NULL DEFAULT false,
  complaint_summary      text,
  unresolved_question    text,
  needs_human            boolean NOT NULL DEFAULT false,
  handoff_reason         text,
  next_action            text,
  last_intent            text,
  last_user_message      text,
  last_bot_message       text,
  raw_summary            jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_memory_topic
  ON public.guest_structured_memory (last_topic, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_memory_booking
  ON public.guest_structured_memory (booking_status, check_in)
  WHERE booking_status IS NOT NULL AND booking_status <> 'none';

CREATE INDEX IF NOT EXISTS idx_guest_memory_needs_human
  ON public.guest_structured_memory (needs_human, updated_at DESC)
  WHERE needs_human = true OR complaint_active = true;

CREATE OR REPLACE FUNCTION public._jsonb_text(p_json jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT NULLIF(btrim(p_json ->> p_key), '')
$$;

CREATE OR REPLACE FUNCTION public._jsonb_date(p_json jsonb, p_key text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := NULLIF(btrim(p_json ->> p_key), '');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  IF v !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN v::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._jsonb_int(p_json jsonb, p_key text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := NULLIF(btrim(p_json ->> p_key), '');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  IF v !~ '^\d+$' THEN
    RETURN NULL;
  END IF;
  RETURN v::integer;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._jsonb_bool(p_json jsonb, p_key text, p_default boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text := lower(NULLIF(btrim(p_json ->> p_key), ''));
BEGIN
  IF v IS NULL THEN
    RETURN p_default;
  END IF;
  IF v IN ('true','t','1','yes','ya') THEN
    RETURN true;
  END IF;
  IF v IN ('false','f','0','no','tidak') THEN
    RETURN false;
  END IF;
  RETURN p_default;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_guest_structured_memory_from_summary(
  p_thread_id uuid,
  p_phone     text,
  p_summary   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_phone text;
  v_payload jsonb := COALESCE(p_summary, '{}'::jsonb);
  v_result jsonb;
BEGIN
  IF v_phone IS NULL AND p_thread_id IS NOT NULL THEN
    SELECT public.resolve_wa_canonical_phone(phone)
      INTO v_thread_phone
    FROM public.whatsapp_threads
    WHERE id = p_thread_id;
    v_phone := v_thread_phone;
  END IF;

  IF v_phone IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  INSERT INTO public.guest_structured_memory (
    canonical_phone,
    thread_id,
    guest_name,
    last_topic,
    room_type,
    check_in,
    check_out,
    guest_count,
    adults,
    children,
    booking_status,
    payment_status,
    source_channel,
    budget_note,
    special_requests,
    preference_notes,
    complaint_active,
    complaint_summary,
    unresolved_question,
    needs_human,
    handoff_reason,
    next_action,
    last_intent,
    last_user_message,
    last_bot_message,
    raw_summary,
    last_seen_at,
    updated_at
  ) VALUES (
    v_phone,
    p_thread_id,
    public._jsonb_text(v_payload, 'guest_name'),
    public._jsonb_text(v_payload, 'last_topic'),
    public._jsonb_text(v_payload, 'room_type'),
    public._jsonb_date(v_payload, 'check_in'),
    public._jsonb_date(v_payload, 'check_out'),
    public._jsonb_int(v_payload, 'guest_count'),
    public._jsonb_int(v_payload, 'adults'),
    public._jsonb_int(v_payload, 'children'),
    public._jsonb_text(v_payload, 'booking_status'),
    public._jsonb_text(v_payload, 'payment_status'),
    public._jsonb_text(v_payload, 'source_channel'),
    public._jsonb_text(v_payload, 'budget_note'),
    public._jsonb_text(v_payload, 'special_requests'),
    public._jsonb_text(v_payload, 'preference_notes'),
    public._jsonb_bool(v_payload, 'complaint_active', false),
    public._jsonb_text(v_payload, 'complaint_summary'),
    public._jsonb_text(v_payload, 'unresolved_question'),
    public._jsonb_bool(v_payload, 'needs_human', false),
    public._jsonb_text(v_payload, 'handoff_reason'),
    public._jsonb_text(v_payload, 'next_action'),
    public._jsonb_text(v_payload, 'last_intent'),
    public._jsonb_text(v_payload, 'last_user_message'),
    public._jsonb_text(v_payload, 'last_bot_message'),
    v_payload,
    now(),
    now()
  )
  ON CONFLICT (canonical_phone)
  DO UPDATE SET
    thread_id = COALESCE(EXCLUDED.thread_id, public.guest_structured_memory.thread_id),
    guest_name = COALESCE(EXCLUDED.guest_name, public.guest_structured_memory.guest_name),
    last_topic = COALESCE(EXCLUDED.last_topic, public.guest_structured_memory.last_topic),
    room_type = COALESCE(EXCLUDED.room_type, public.guest_structured_memory.room_type),
    check_in = COALESCE(EXCLUDED.check_in, public.guest_structured_memory.check_in),
    check_out = COALESCE(EXCLUDED.check_out, public.guest_structured_memory.check_out),
    guest_count = COALESCE(EXCLUDED.guest_count, public.guest_structured_memory.guest_count),
    adults = COALESCE(EXCLUDED.adults, public.guest_structured_memory.adults),
    children = COALESCE(EXCLUDED.children, public.guest_structured_memory.children),
    booking_status = COALESCE(EXCLUDED.booking_status, public.guest_structured_memory.booking_status),
    payment_status = COALESCE(EXCLUDED.payment_status, public.guest_structured_memory.payment_status),
    source_channel = COALESCE(EXCLUDED.source_channel, public.guest_structured_memory.source_channel),
    budget_note = COALESCE(EXCLUDED.budget_note, public.guest_structured_memory.budget_note),
    special_requests = COALESCE(EXCLUDED.special_requests, public.guest_structured_memory.special_requests),
    preference_notes = COALESCE(EXCLUDED.preference_notes, public.guest_structured_memory.preference_notes),
    complaint_active = EXCLUDED.complaint_active OR public.guest_structured_memory.complaint_active,
    complaint_summary = COALESCE(EXCLUDED.complaint_summary, public.guest_structured_memory.complaint_summary),
    unresolved_question = COALESCE(EXCLUDED.unresolved_question, public.guest_structured_memory.unresolved_question),
    needs_human = EXCLUDED.needs_human OR public.guest_structured_memory.needs_human,
    handoff_reason = COALESCE(EXCLUDED.handoff_reason, public.guest_structured_memory.handoff_reason),
    next_action = COALESCE(EXCLUDED.next_action, public.guest_structured_memory.next_action),
    last_intent = COALESCE(EXCLUDED.last_intent, public.guest_structured_memory.last_intent),
    last_user_message = COALESCE(EXCLUDED.last_user_message, public.guest_structured_memory.last_user_message),
    last_bot_message = COALESCE(EXCLUDED.last_bot_message, public.guest_structured_memory.last_bot_message),
    raw_summary = public.guest_structured_memory.raw_summary || EXCLUDED.raw_summary,
    last_seen_at = now(),
    updated_at = now();

  SELECT jsonb_strip_nulls(to_jsonb(m))
    INTO v_result
  FROM public.guest_structured_memory m
  WHERE m.canonical_phone = v_phone;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_guest_structured_memory_from_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.chat_summary_json, '{}'::jsonb) <> '{}'::jsonb THEN
    PERFORM public.upsert_guest_structured_memory_from_summary(
      NEW.id,
      NEW.phone,
      NEW.chat_summary_json
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guest_structured_memory ON public.whatsapp_threads;
CREATE TRIGGER trg_sync_guest_structured_memory
AFTER INSERT OR UPDATE OF phone, chat_summary_json, display_name ON public.whatsapp_threads
FOR EACH ROW EXECUTE FUNCTION public.sync_guest_structured_memory_from_thread();

CREATE OR REPLACE FUNCTION public.get_guest_structured_memory(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_result jsonb;
BEGIN
  IF v_phone IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_strip_nulls(to_jsonb(m))
    INTO v_result
  FROM public.guest_structured_memory m
  WHERE m.canonical_phone = v_phone
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Backfill from existing thread summaries.
INSERT INTO public.guest_structured_memory (
  canonical_phone,
  thread_id,
  guest_name,
  last_topic,
  room_type,
  check_in,
  check_out,
  guest_count,
  booking_status,
  payment_status,
  complaint_active,
  unresolved_question,
  needs_human,
  handoff_reason,
  raw_summary,
  last_seen_at,
  updated_at
)
SELECT DISTINCT ON (public.resolve_wa_canonical_phone(t.phone))
  public.resolve_wa_canonical_phone(t.phone),
  t.id,
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'guest_name'),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'last_topic'),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'room_type'),
  public._jsonb_date(COALESCE(t.chat_summary_json, '{}'::jsonb), 'check_in'),
  public._jsonb_date(COALESCE(t.chat_summary_json, '{}'::jsonb), 'check_out'),
  public._jsonb_int(COALESCE(t.chat_summary_json, '{}'::jsonb), 'guest_count'),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'booking_status'),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'payment_status'),
  public._jsonb_bool(COALESCE(t.chat_summary_json, '{}'::jsonb), 'complaint_active', false),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'unresolved_question'),
  public._jsonb_bool(COALESCE(t.chat_summary_json, '{}'::jsonb), 'needs_human', false),
  public._jsonb_text(COALESCE(t.chat_summary_json, '{}'::jsonb), 'handoff_reason'),
  COALESCE(t.chat_summary_json, '{}'::jsonb),
  COALESCE(t.last_message_at, t.created_at, now()),
  now()
FROM public.whatsapp_threads t
WHERE public.resolve_wa_canonical_phone(t.phone) IS NOT NULL
  AND COALESCE(t.chat_summary_json, '{}'::jsonb) <> '{}'::jsonb
ORDER BY public.resolve_wa_canonical_phone(t.phone), t.last_message_at DESC NULLS LAST
ON CONFLICT (canonical_phone) DO NOTHING;

-- Canonical-aware get_autoreply_context + guest memory injection.
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
  v_guest_memory            jsonb   := '{}'::jsonb;
  v_effective_summary_json  jsonb   := '{}'::jsonb;
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

  v_guest_memory := public.get_guest_structured_memory(v_phone);
  v_effective_summary_json := jsonb_strip_nulls(v_guest_memory) || jsonb_strip_nulls(v_chat_summary_json);

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
    'chat_summary_json',       v_effective_summary_json,
    'guest_memory',            v_guest_memory,
    'chat_summary_version',    v_chat_summary_version,
    'chat_summary_updated_at', v_chat_summary_updated_at
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_structured_memory TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.guest_structured_memory TO anon;
GRANT EXECUTE ON FUNCTION public.upsert_guest_structured_memory_from_summary(uuid, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_guest_structured_memory(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
