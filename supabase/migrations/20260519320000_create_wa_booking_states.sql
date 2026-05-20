CREATE TABLE IF NOT EXISTS wa_booking_states (
  phone TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'IDLE',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-update the updated_at column
CREATE OR REPLACE FUNCTION update_wa_booking_states_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wa_booking_states_updated_at ON wa_booking_states;
CREATE TRIGGER trg_wa_booking_states_updated_at
BEFORE UPDATE ON wa_booking_states
FOR EACH ROW
EXECUTE FUNCTION update_wa_booking_states_updated_at();

-- Enable RLS
ALTER TABLE wa_booking_states ENABLE ROW LEVEL SECURITY;

-- Allow read/write for service_role and admins
CREATE POLICY "Enable all access for service role on wa_booking_states"
ON wa_booking_states FOR ALL
USING (true) WITH CHECK (true);

-- RPC to get or create a state, automatically resetting if older than 15 minutes
CREATE OR REPLACE FUNCTION get_active_booking_state(p_phone TEXT)
RETURNS JSON AS $$
DECLARE
  v_state_record RECORD;
  v_timeout_interval INTERVAL := '15 minutes';
BEGIN
  -- Try to find the record
  SELECT * INTO v_state_record
  FROM wa_booking_states
  WHERE phone = p_phone;

  -- If not exists, insert a default IDLE state
  IF NOT FOUND THEN
    INSERT INTO wa_booking_states (phone, state, context)
    VALUES (p_phone, 'IDLE', '{}'::jsonb)
    RETURNING * INTO v_state_record;
  ELSE
    -- If it exists but is older than 15 minutes, and NOT idle, reset it.
    IF v_state_record.state != 'IDLE' AND v_state_record.updated_at < (NOW() - v_timeout_interval) THEN
      UPDATE wa_booking_states
      SET state = 'IDLE', context = '{}'::jsonb, updated_at = NOW()
      WHERE phone = p_phone
      RETURNING * INTO v_state_record;
    END IF;
  END IF;

  RETURN json_build_object(
    'phone', v_state_record.phone,
    'state', v_state_record.state,
    'context', v_state_record.context,
    'updated_at', v_state_record.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC to update state and context
CREATE OR REPLACE FUNCTION update_booking_state(
  p_phone TEXT,
  p_state TEXT,
  p_context JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO wa_booking_states (phone, state, context)
  VALUES (p_phone, p_state, p_context)
  ON CONFLICT (phone)
  DO UPDATE SET
    state = EXCLUDED.state,
    context = EXCLUDED.context,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
