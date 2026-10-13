-- Reaction emoji WhatsApp disimpan di whatsapp_messages.metadata.reactions
-- ({ "<nomor pengirim>": { "emoji": "👍", "at": "...", "direction": "in" } }).
-- RPC atomik supaya dua reaction bersamaan tidak saling menimpa metadata.
CREATE OR REPLACE FUNCTION public.apply_whatsapp_message_reaction(
  p_message_id uuid,
  p_reactor text,
  p_emoji text,
  p_at timestamptz,
  p_direction text DEFAULT 'in'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_meta jsonb;
  v_prev jsonb;
  v_reactions jsonb;
BEGIN
  SELECT COALESCE(metadata, '{}'::jsonb) INTO v_meta
  FROM whatsapp_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_reactions := CASE WHEN jsonb_typeof(v_meta->'reactions') = 'object'
                      THEN v_meta->'reactions' ELSE '{}'::jsonb END;
  v_prev := v_reactions->p_reactor;
  -- Event terlambat tidak menimpa reaction yang lebih baru.
  IF v_prev IS NOT NULL AND (v_prev->>'at') IS NOT NULL
     AND (v_prev->>'at')::timestamptz > p_at THEN
    RETURN true;
  END IF;

  IF COALESCE(btrim(p_emoji), '') = '' THEN
    v_reactions := v_reactions - p_reactor;
  ELSE
    v_reactions := v_reactions || jsonb_build_object(
      p_reactor,
      jsonb_build_object('emoji', btrim(p_emoji), 'at', p_at,
                         'direction', CASE WHEN p_direction = 'out' THEN 'out' ELSE 'in' END)
    );
  END IF;

  UPDATE whatsapp_messages
  SET metadata = jsonb_set(v_meta, '{reactions}', v_reactions, true)
  WHERE id = p_message_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.apply_whatsapp_message_reaction(uuid, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_message_reaction(uuid, text, text, timestamptz, text) TO service_role;
