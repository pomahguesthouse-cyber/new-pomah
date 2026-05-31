-- ============================================================
-- Conversation state: add lightweight topic/entity/slot tracking
-- so the router can resolve short follow-ups ("kalau deluxe",
-- "yang bawah", "2 malam") without relying on an LLM guess.
--
-- The wa_booking_states table already lives per-phone with a
-- 15-minute idle-reset. We piggy-back three nullable jsonb/text
-- columns on it so there is still ONE source of truth per phone.
-- ============================================================

ALTER TABLE public.wa_booking_states
  ADD COLUMN IF NOT EXISTS last_topic   TEXT,
  ADD COLUMN IF NOT EXISTS last_entity  JSONB,
  ADD COLUMN IF NOT EXISTS slots        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS topic_updated_at TIMESTAMPTZ;

-- Replace get_active_booking_state so it returns the new fields too.
-- Topic/entity get their own 10-minute idle reset, independent of the
-- booking state's 15-minute reset (a guest may continue asking facts
-- about a room long after they stopped touching the booking flow,
-- but a stale topic from yesterday should not bleed into a new session).
CREATE OR REPLACE FUNCTION public.get_active_booking_state(p_phone TEXT)
RETURNS JSON AS $$
DECLARE
  v_state_record RECORD;
  v_booking_timeout INTERVAL := '15 minutes';
  v_topic_timeout   INTERVAL := '10 minutes';
BEGIN
  SELECT * INTO v_state_record FROM public.wa_booking_states WHERE phone = p_phone;

  IF NOT FOUND THEN
    INSERT INTO public.wa_booking_states (phone, state, context)
    VALUES (p_phone, 'IDLE', '{}'::jsonb)
    RETURNING * INTO v_state_record;
  ELSE
    -- Reset booking flow if idle and stale
    IF v_state_record.state != 'IDLE'
       AND v_state_record.updated_at < (NOW() - v_booking_timeout) THEN
      UPDATE public.wa_booking_states
      SET state = 'IDLE', context = '{}'::jsonb, updated_at = NOW()
      WHERE phone = p_phone
      RETURNING * INTO v_state_record;
    END IF;

    -- Independently drop a stale topic/entity (do NOT clear slots —
    -- the guest may legitimately come back with the same intent).
    IF v_state_record.topic_updated_at IS NOT NULL
       AND v_state_record.topic_updated_at < (NOW() - v_topic_timeout) THEN
      UPDATE public.wa_booking_states
      SET last_topic = NULL,
          last_entity = NULL,
          topic_updated_at = NULL
      WHERE phone = p_phone
      RETURNING * INTO v_state_record;
    END IF;
  END IF;

  RETURN json_build_object(
    'phone',        v_state_record.phone,
    'state',        v_state_record.state,
    'context',      v_state_record.context,
    'updated_at',   v_state_record.updated_at,
    'last_topic',   v_state_record.last_topic,
    'last_entity',  v_state_record.last_entity,
    'slots',        COALESCE(v_state_record.slots, '{}'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- New RPC: update topic/entity/slots WITHOUT touching the booking state
-- (so a resolver tick doesn't accidentally reset the booking flow timer).
CREATE OR REPLACE FUNCTION public.update_conversation_topic(
  p_phone       TEXT,
  p_last_topic  TEXT,
  p_last_entity JSONB,
  p_slots       JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.wa_booking_states (phone, state, context, last_topic, last_entity, slots, topic_updated_at)
  VALUES (p_phone, 'IDLE', '{}'::jsonb, p_last_topic, p_last_entity, COALESCE(p_slots, '{}'::jsonb), NOW())
  ON CONFLICT (phone)
  DO UPDATE SET
    last_topic       = EXCLUDED.last_topic,
    last_entity      = EXCLUDED.last_entity,
    slots            = COALESCE(EXCLUDED.slots, public.wa_booking_states.slots),
    topic_updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.update_conversation_topic(TEXT, TEXT, JSONB, JSONB) FROM anon, authenticated;
