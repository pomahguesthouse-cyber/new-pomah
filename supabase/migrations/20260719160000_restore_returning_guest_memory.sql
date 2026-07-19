-- Restore durable returning-guest memory in the WhatsApp autoreply context.
--
-- A later LID/send-target migration and the human-takeover migration recreated
-- get_autoreply_context without the guest_structured_memory merge introduced
-- earlier. This migration composes all required behaviour in one current RPC:
-- canonical/LID identity, send_target, ai_paused_until, thread summary, durable
-- guest memory, and deterministic booking-backed guest profile.

CREATE OR REPLACE FUNCTION public.get_returning_guest_profile(
  p_phone text,
  p_thread_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canonical text := public.resolve_wa_canonical_phone(p_phone);
  v_guest_id uuid;
  v_result jsonb;
BEGIN
  IF p_thread_id IS NOT NULL THEN
    SELECT wt.guest_id
      INTO v_guest_id
    FROM public.whatsapp_threads wt
    WHERE wt.id = p_thread_id
    LIMIT 1;
  END IF;

  IF v_guest_id IS NULL AND v_canonical IS NOT NULL THEN
    SELECT g.id
      INTO v_guest_id
    FROM public.guests g
    WHERE g.phone_normalized = public.normalize_phone_id(v_canonical)
      AND g.merged_into IS NULL
    ORDER BY g.last_seen_at DESC NULLS LAST, g.created_at ASC
    LIMIT 1;
  END IF;

  IF v_guest_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_strip_nulls(
    jsonb_build_object(
      'guest_id', g.id,
      'full_name', COALESCE(NULLIF(btrim(g.real_name), ''), NULLIF(btrim(g.full_name), ''), NULLIF(btrim(g.display_name), '')),
      'display_name', NULLIF(btrim(g.display_name), ''),
      'email', NULLIF(btrim(g.email), ''),
      'phone', g.phone_normalized,
      'source', g.source,
      'total_bookings', COALESCE(g.total_bookings, 0),
      'first_seen_at', g.first_seen_at,
      'last_seen_at', g.last_seen_at,
      'bookings', COALESCE((
        SELECT jsonb_agg(
          to_jsonb(bx)
          ORDER BY
            bx.is_upcoming DESC,
            CASE WHEN bx.is_upcoming THEN bx.check_in END ASC,
            bx.check_in DESC
        )
        FROM (
          SELECT
            b.id,
            b.reference_code,
            b.check_in,
            b.check_out,
            b.status,
            b.payment_status,
            b.adults,
            b.children,
            b.total_amount,
            b.paid_amount,
            rt.name AS room_type,
            b.special_requests,
            (b.status <> 'cancelled' AND b.check_out >= current_date) AS is_upcoming
          FROM public.bookings b
          LEFT JOIN public.room_types rt ON rt.id = b.room_type_id
          WHERE b.guest_id = g.id
          ORDER BY
            (b.status <> 'cancelled' AND b.check_out >= current_date) DESC,
            CASE
              WHEN b.status <> 'cancelled' AND b.check_out >= current_date
                THEN b.check_in
            END ASC,
            b.check_in DESC
          LIMIT 5
        ) bx
      ), '[]'::jsonb)
    )
  )
  INTO v_result
  FROM public.guests g
  WHERE g.id = v_guest_id
    AND g.merged_into IS NULL
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- This helper exposes personal booking data and is only called from the
-- server-side SECURITY DEFINER context RPC.
REVOKE ALL ON FUNCTION public.get_returning_guest_profile(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_returning_guest_profile(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_returning_guest_profile(text, uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.sync_guest_memory_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_guest public.guests%ROWTYPE;
  v_booking record;
  v_phone text;
BEGIN
  IF NEW.guest_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO v_guest
  FROM public.guests
  WHERE id = NEW.guest_id;

  IF v_guest.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_phone := public.normalize_phone_id(v_guest.phone);
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pick the most relevant booking after every booking mutation: the nearest
  -- current/upcoming non-cancelled stay, otherwise the latest historical stay.
  SELECT
    b.check_in,
    b.check_out,
    b.status::text AS status,
    b.payment_status::text AS payment_status,
    b.adults,
    b.children,
    b.special_requests,
    rt.name AS room_type
  INTO v_booking
  FROM public.bookings b
  LEFT JOIN public.room_types rt ON rt.id = b.room_type_id
  WHERE b.guest_id = NEW.guest_id
  ORDER BY
    (b.status <> 'cancelled' AND b.check_out >= current_date) DESC,
    CASE
      WHEN b.status <> 'cancelled' AND b.check_out >= current_date
        THEN b.check_in
    END ASC,
    b.check_in DESC
  LIMIT 1;

  INSERT INTO public.guest_structured_memory (
    canonical_phone,
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
    special_requests,
    last_seen_at,
    updated_at
  ) VALUES (
    v_phone,
    COALESCE(NULLIF(btrim(v_guest.real_name), ''), NULLIF(btrim(v_guest.full_name), ''), NULLIF(btrim(v_guest.display_name), '')),
    'booking',
    v_booking.room_type,
    v_booking.check_in,
    v_booking.check_out,
    COALESCE(v_booking.adults, 0) + COALESCE(v_booking.children, 0),
    v_booking.adults,
    v_booking.children,
    public.normalize_guest_booking_status(v_booking.status),
    public.normalize_guest_payment_status(v_booking.payment_status),
    NULLIF(btrim(v_booking.special_requests), ''),
    now(),
    now()
  )
  ON CONFLICT (canonical_phone)
  DO UPDATE SET
    guest_name = COALESCE(EXCLUDED.guest_name, public.guest_structured_memory.guest_name),
    last_topic = 'booking',
    room_type = COALESCE(EXCLUDED.room_type, public.guest_structured_memory.room_type),
    check_in = COALESCE(EXCLUDED.check_in, public.guest_structured_memory.check_in),
    check_out = COALESCE(EXCLUDED.check_out, public.guest_structured_memory.check_out),
    guest_count = COALESCE(EXCLUDED.guest_count, public.guest_structured_memory.guest_count),
    adults = COALESCE(EXCLUDED.adults, public.guest_structured_memory.adults),
    children = COALESCE(EXCLUDED.children, public.guest_structured_memory.children),
    booking_status = COALESCE(EXCLUDED.booking_status, public.guest_structured_memory.booking_status),
    payment_status = COALESCE(EXCLUDED.payment_status, public.guest_structured_memory.payment_status),
    special_requests = COALESCE(EXCLUDED.special_requests, public.guest_structured_memory.special_requests),
    last_seen_at = now(),
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_guest_memory_from_booking() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_guest_memory_from_booking() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_sync_guest_memory ON public.bookings;
CREATE TRIGGER trg_booking_sync_guest_memory
AFTER INSERT OR UPDATE OF guest_id, room_type_id, check_in, check_out, status,
  payment_status, adults, children, special_requests
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_guest_memory_from_booking();


CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_identity                text := public.normalize_wa_identity(p_phone);
  v_canonical               text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id               uuid;
  v_thread_phone            text;
  v_thread_canonical        text;
  v_external_chat_id        text;
  v_lid_alias               text;
  v_send_target             text;
  v_ai_auto                 boolean := true;
  v_ai_paused_until         timestamptz;
  v_auto_reply              boolean := false;
  v_wpp_token               text    := '';
  v_ai_lab_config           jsonb   := '{}';
  v_smart_delay_cfg         jsonb   := NULL;
  v_chat_summary            text    := '';
  v_chat_summary_json       jsonb   := '{}'::jsonb;
  v_guest_memory            jsonb   := '{}'::jsonb;
  v_guest_profile           jsonb   := '{}'::jsonb;
  v_effective_summary_json  jsonb   := '{}'::jsonb;
  v_chat_summary_version    integer := 1;
  v_chat_summary_updated_at timestamptz;
  v_messages                jsonb   := '[]';
BEGIN
  SELECT
    wt.id,
    wt.phone,
    wt.canonical_phone,
    wt.external_chat_id,
    wt.lid_alias,
    wt.ai_auto,
    wt.ai_paused_until,
    COALESCE(wt.chat_summary, ''),
    COALESCE(wt.chat_summary_json, '{}'::jsonb),
    COALESCE(wt.chat_summary_version, 1),
    wt.chat_summary_updated_at
  INTO
    v_thread_id,
    v_thread_phone,
    v_thread_canonical,
    v_external_chat_id,
    v_lid_alias,
    v_ai_auto,
    v_ai_paused_until,
    v_chat_summary,
    v_chat_summary_json,
    v_chat_summary_version,
    v_chat_summary_updated_at
  FROM public.whatsapp_threads wt
  WHERE wt.phone IN (p_phone, v_identity, v_canonical)
     OR wt.canonical_phone IN (p_phone, v_identity, v_canonical)
     OR public.normalize_wa_identity(wt.external_chat_id) IN (v_identity, v_canonical)
     OR public.normalize_wa_identity(wt.lid_alias) IN (v_identity, v_canonical)
  ORDER BY
    CASE WHEN public.normalize_wa_identity(wt.phone) = v_canonical THEN 0 ELSE 1 END,
    wt.last_message_at DESC NULLS LAST,
    wt.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_canonical IS NULL THEN
    v_canonical := public.resolve_wa_canonical_phone(v_thread_phone);
  END IF;

  v_send_target := COALESCE(
    NULLIF(v_external_chat_id, ''),
    NULLIF(v_thread_canonical, ''),
    NULLIF(v_canonical, ''),
    NULLIF(v_thread_phone, ''),
    p_phone
  );

  IF v_send_target ~ '^[0-9]{10,18}$'
     AND v_send_target !~ '^62[0-9]{8,14}$' THEN
    v_send_target := v_send_target || '@lid';
  END IF;

  SELECT
    COALESCE(wpp_token, ''),
    COALESCE(ai_lab_config, '{}'),
    smart_delay_config
  INTO
    v_wpp_token,
    v_ai_lab_config,
    v_smart_delay_cfg
  FROM public.properties
  LIMIT 1;

  v_guest_memory := public.get_guest_structured_memory(v_canonical);
  v_guest_profile := public.get_returning_guest_profile(v_canonical, v_thread_id);

  -- Durable memory supplies older stable facts; the current thread summary wins
  -- when the guest has just corrected or changed something.
  v_effective_summary_json :=
    jsonb_strip_nulls(COALESCE(v_guest_memory, '{}'::jsonb))
    || jsonb_strip_nulls(COALESCE(v_chat_summary_json, '{}'::jsonb));

  v_auto_reply := COALESCE(
    (v_ai_lab_config -> 'agents' -> 'front-office' ->> 'autoReply')::boolean,
    false
  )
  AND v_ai_auto
  AND (v_ai_paused_until IS NULL OR now() >= v_ai_paused_until);

  SELECT jsonb_agg(
    jsonb_build_object(
      'direction', wm.direction,
      'body', wm.body,
      'sent_at', wm.sent_at
    )
    ORDER BY wm.sent_at ASC
  )
  INTO v_messages
  FROM (
    SELECT direction, body, sent_at
    FROM public.whatsapp_messages
    WHERE thread_id = v_thread_id
    ORDER BY sent_at DESC
    LIMIT 30
  ) wm;

  RETURN jsonb_build_object(
    'thread_id',               v_thread_id,
    'thread_phone',            v_thread_phone,
    'canonical_phone',         v_canonical,
    'external_chat_id',        v_external_chat_id,
    'lid_alias',               v_lid_alias,
    'send_target',             v_send_target,
    'auto_reply_enabled',      v_auto_reply,
    'ai_paused_until',         v_ai_paused_until,
    'wpp_token',               v_wpp_token,
    'messages',                COALESCE(v_messages, '[]'::jsonb),
    'smart_delay_config',      v_smart_delay_cfg,
    'chat_summary',            v_chat_summary,
    'chat_summary_json',       v_effective_summary_json,
    'guest_memory',            v_guest_memory,
    'guest_profile',           v_guest_profile,
    'chat_summary_version',    v_chat_summary_version,
    'chat_summary_updated_at', v_chat_summary_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_autoreply_context(text) TO anon, authenticated, service_role;

-- Backfill deterministic booking facts for existing guests. Updating a harmless
-- booking column through the trigger would be noisy, so call the trigger logic
-- with the latest booking row per guest by performing a no-op update.
UPDATE public.bookings
SET guest_id = guest_id
WHERE id IN (
  SELECT DISTINCT ON (guest_id) id
  FROM public.bookings
  WHERE guest_id IS NOT NULL
  ORDER BY guest_id, check_in DESC
);

NOTIFY pgrst, 'reload schema';
