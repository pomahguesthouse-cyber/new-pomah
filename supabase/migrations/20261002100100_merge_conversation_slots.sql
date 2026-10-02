-- Fix: update_conversation_topic menimpa seluruh kolom slots.
--
-- Sebelumnya: slots = COALESCE(EXCLUDED.slots, existing). Karena INSERT selalu
-- mengirim COALESCE(p_slots, '{}'), EXCLUDED.slots tidak pernah NULL sehingga
-- setiap panggilan (mis. fast-path availability yang hanya mengirim
-- {checkIn, checkOut}) menghapus jumlah tamu, tipe kamar, dll. yang sudah ada.
--
-- Sekarang: slots digabung (jsonb ||), key baru menang, key lama yang tidak
-- dikirim dipertahankan. p_slots NULL / bukan object = tidak mengubah slots.
-- Signature dan grants tidak berubah. Idempoten.

CREATE OR REPLACE FUNCTION public.update_conversation_topic(
  p_phone       TEXT,
  p_last_topic  TEXT,
  p_last_entity JSONB,
  p_slots       JSONB
) RETURNS VOID AS $$
DECLARE
  v_slots JSONB := CASE
    WHEN p_slots IS NOT NULL AND jsonb_typeof(p_slots) = 'object' THEN p_slots
    ELSE '{}'::jsonb
  END;
BEGIN
  INSERT INTO public.wa_booking_states (phone, state, context, last_topic, last_entity, slots, topic_updated_at)
  VALUES (p_phone, 'IDLE', '{}'::jsonb, p_last_topic, p_last_entity, v_slots, NOW())
  ON CONFLICT (phone)
  DO UPDATE SET
    last_topic       = EXCLUDED.last_topic,
    last_entity      = EXCLUDED.last_entity,
    slots            = COALESCE(public.wa_booking_states.slots, '{}'::jsonb) || COALESCE(EXCLUDED.slots, '{}'::jsonb),
    topic_updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.update_conversation_topic(TEXT, TEXT, JSONB, JSONB) FROM anon, authenticated;
