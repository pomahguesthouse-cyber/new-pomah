-- ============================================================
-- Fix double-reply race in receive_whatsapp_message (no-wpp_id path)
-- ============================================================
--
-- Bug: for inbound messages without a durable wpp_id (webchat widget, WA
-- simulator, or any provider that omits a message id), the app
-- (message.repository.ts) used to run a SELECT "is there a recent identical
-- body?" check, then call this RPC to insert — two SEPARATE round-trips to
-- Postgres with no shared transaction. Two near-simultaneous webhook
-- deliveries for the same message (simulator double-fire, retry) can both
-- run the SELECT before either INSERT commits, both see "no duplicate," and
-- both proceed — creating two whatsapp_messages rows and, downstream, two
-- AI replies for one guest question. Same bug class already fixed for
-- wa_queue_upsert in 20260528130000_wa_queue_upsert_advisory_lock.sql; this
-- migration applies the identical fix (transaction-scoped advisory lock +
-- atomic check-then-insert) one layer earlier, at message ingestion.
--
-- Fix: move the body-dedup check INTO this function, behind a
-- pg_advisory_xact_lock keyed on the resolved phone. Concurrent calls for
-- the same phone now serialize — the second call's dedup check runs only
-- after the first call's insert has committed, so it correctly finds the
-- row and returns it instead of inserting a duplicate.
--
-- Return shape changes from a plain uuid to TABLE(message_id, is_duplicate)
-- so callers (message.repository.ts) can skip re-enqueueing/re-notifying
-- on a detected duplicate, exactly as the wpp_id-based dedup path already did.
-- ============================================================

DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text, text, text, text);
DROP FUNCTION IF EXISTS public.receive_whatsapp_message(text, text, text);

CREATE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name text,
  p_body text,
  p_wpp_id text DEFAULT NULL
) RETURNS TABLE(message_id uuid, is_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_normalized text := public.normalize_wa_identity(p_phone);
  v_from_lid boolean := public.is_lid_identity(p_phone) OR public.is_lid_identity(p_wpp_id);
  v_phone text := public.resolve_wa_canonical_phone(p_phone);
  v_thread_id uuid;
  v_message_id uuid;
  v_wpp_id text := NULLIF(btrim(p_wpp_id), '');
  v_unresolved boolean;
  v_meta jsonb;
BEGIN
  IF v_phone IS NULL THEN v_phone := v_normalized; END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'phone identity kosong'; END IF;
  v_unresolved := v_from_lid AND NOT public.is_resolved_public_wa_phone(p_phone);

  -- Serialize all inbound saves for this phone for the duration of this
  -- transaction, closing the TOCTOU gap between the dedup check below and
  -- the insert further down. Released automatically on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('receive_whatsapp_message:' || v_phone)::bigint);

  IF v_wpp_id IS NOT NULL THEN
    SELECT id INTO v_message_id FROM public.whatsapp_messages WHERE wpp_id = v_wpp_id LIMIT 1;
    IF v_message_id IS NOT NULL THEN
      RETURN QUERY SELECT v_message_id, true;
      RETURN;
    END IF;
  END IF;

  PERFORM public.upsert_wa_identity_alias(
    v_phone,
    COALESCE(v_normalized, p_phone),
    CASE WHEN v_from_lid THEN 'lid' WHEN public.is_public_wa_phone(p_phone) THEN 'phone' ELSE 'unknown' END,
    'unknown',
    p_name,
    'receive_whatsapp_message',
    jsonb_build_object('wpp_id', v_wpp_id, 'identity_unresolved', v_unresolved)
  );

  SELECT id INTO v_thread_id
  FROM public.whatsapp_threads
  WHERE phone = v_phone
  ORDER BY last_message_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.whatsapp_threads (phone, display_name, status, unread_count)
    VALUES (v_phone, p_name, 'open', 0)
    RETURNING id INTO v_thread_id;
  ELSIF v_wpp_id IS NULL THEN
    -- Durable body-dedup for messages without a wpp_id (webchat/simulator).
    -- Serialized by the advisory lock above, so this now atomically closes
    -- the "Insiden 4 Jul 2026" race (two webhook fires ~360ms apart both
    -- passing the check before either insert committed).
    SELECT id INTO v_message_id
    FROM public.whatsapp_messages
    WHERE thread_id = v_thread_id
      AND direction = 'in'
      AND body = p_body
      AND created_at >= now() - interval '20 seconds'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RETURN QUERY SELECT v_message_id, true;
      RETURN;
    END IF;
  END IF;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'raw_identity', p_phone,
    'identity_type', CASE WHEN v_from_lid THEN 'lid' WHEN public.is_public_wa_phone(p_phone) THEN 'phone' ELSE 'unknown' END,
    'lid_alias', CASE WHEN v_from_lid THEN v_normalized ELSE NULL END,
    'canonical_phone', v_phone,
    'identity_unresolved', v_unresolved,
    'wpp_id', v_wpp_id
  ));

  INSERT INTO public.whatsapp_messages (thread_id, direction, body, wpp_id, metadata)
  VALUES (v_thread_id, 'in', p_body, v_wpp_id, v_meta)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    display_name = COALESCE(NULLIF(p_name, ''), display_name),
    last_message_preview = LEFT(p_body, 120),
    last_message_at = now(),
    unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = v_thread_id;

  RETURN QUERY SELECT v_message_id, false;
END;
$$;

CREATE FUNCTION public.receive_whatsapp_message(p_phone text, p_name text, p_body text)
RETURNS TABLE(message_id uuid, is_duplicate boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.receive_whatsapp_message(p_phone, p_name, p_body, NULL::text);
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text) TO anon, authenticated, service_role;

-- 5-arg wrapper (LID external_chat_id variant) now consumes a table return
-- from the 4-arg function instead of a scalar uuid.
CREATE OR REPLACE FUNCTION public.receive_whatsapp_message(
  p_phone text,
  p_name text,
  p_body text,
  p_wpp_id text,
  p_external_chat_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
  v_thread_id uuid;
  v_external_raw text := NULLIF(btrim(coalesce(p_external_chat_id, '')), '');
  v_external_identity text := public.normalize_wa_identity(v_external_raw);
  v_canonical text := public.resolve_wa_canonical_phone(coalesce(v_external_raw, p_phone));
  v_is_public boolean := public.is_public_wa_phone(v_canonical);
  v_is_lid boolean := public.is_lid_identity(v_external_raw)
    OR (v_external_identity IS NOT NULL AND NOT public.is_public_wa_phone(v_external_identity));
BEGIN
  SELECT r.message_id INTO v_message_id
  FROM public.receive_whatsapp_message(p_phone, p_name, p_body, p_wpp_id) r;

  IF v_message_id IS NULL OR v_external_raw IS NULL THEN
    RETURN v_message_id;
  END IF;

  SELECT thread_id INTO v_thread_id
  FROM public.whatsapp_messages
  WHERE id = v_message_id;

  UPDATE public.whatsapp_messages
  SET external_chat_id = v_external_raw,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'external_chat_id', v_external_raw,
        'lid_alias', CASE WHEN v_is_lid THEN v_external_identity ELSE NULL END,
        'canonical_phone', CASE WHEN v_is_public THEN v_canonical ELSE NULL END,
        'identity_unresolved', NOT v_is_public
      ))
  WHERE id = v_message_id;

  IF v_thread_id IS NOT NULL THEN
    UPDATE public.whatsapp_threads
    SET external_chat_id = v_external_raw,
        lid_alias = COALESCE(CASE WHEN v_is_lid THEN v_external_identity END, lid_alias),
        canonical_phone = CASE WHEN v_is_public THEN v_canonical ELSE canonical_phone END,
        phone = CASE WHEN v_is_public THEN v_canonical ELSE phone END,
        identity_type = CASE WHEN v_is_public THEN 'phone' WHEN v_is_lid THEN 'lid' ELSE identity_type END,
        sync_error = CASE WHEN v_is_public THEN NULL ELSE COALESCE(sync_error, 'Identity belum terpetakan ke nomor publik') END
    WHERE id = v_thread_id;
  END IF;

  IF v_is_public THEN
    PERFORM public.merge_wa_threads_to_canonical_phone(v_canonical);
  END IF;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_whatsapp_message(text, text, text, text, text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
