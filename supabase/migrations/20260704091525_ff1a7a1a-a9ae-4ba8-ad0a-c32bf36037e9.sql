-- ── 1. Tambah kolom baru + backfill ────────────────────────────────────────
ALTER TABLE public.properties        ADD COLUMN IF NOT EXISTS wpp_token text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS wpp_id    text;

UPDATE public.properties        SET wpp_token = fonnte_token WHERE wpp_token IS NULL AND fonnte_token IS NOT NULL;
UPDATE public.whatsapp_messages SET wpp_id    = fonnte_id    WHERE wpp_id    IS NULL AND fonnte_id    IS NOT NULL;

-- ── 2. Trigger sinkronisasi dua arah (transisi expand/contract) ────────────
CREATE OR REPLACE FUNCTION public.sync_properties_wpp_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Jika hanya salah satu diisi, salin ke yang lain.
  IF NEW.wpp_token IS DISTINCT FROM OLD.wpp_token AND NEW.wpp_token IS NOT NULL
     AND (NEW.fonnte_token IS NULL OR NEW.fonnte_token = COALESCE(OLD.fonnte_token, '')) THEN
    NEW.fonnte_token := NEW.wpp_token;
  ELSIF NEW.fonnte_token IS DISTINCT FROM OLD.fonnte_token AND NEW.fonnte_token IS NOT NULL
     AND (NEW.wpp_token IS NULL OR NEW.wpp_token = COALESCE(OLD.wpp_token, '')) THEN
    NEW.wpp_token := NEW.fonnte_token;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.wpp_token    := COALESCE(NEW.wpp_token,    NEW.fonnte_token);
    NEW.fonnte_token := COALESCE(NEW.fonnte_token, NEW.wpp_token);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_properties_wpp_token ON public.properties;
CREATE TRIGGER trg_sync_properties_wpp_token
BEFORE INSERT OR UPDATE OF fonnte_token, wpp_token ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.sync_properties_wpp_token();

CREATE OR REPLACE FUNCTION public.sync_whatsapp_messages_wpp_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.wpp_id    := COALESCE(NEW.wpp_id,    NEW.fonnte_id);
    NEW.fonnte_id := COALESCE(NEW.fonnte_id, NEW.wpp_id);
  ELSE
    IF NEW.wpp_id IS DISTINCT FROM OLD.wpp_id AND NEW.wpp_id IS NOT NULL
       AND (NEW.fonnte_id IS NULL OR NEW.fonnte_id = COALESCE(OLD.fonnte_id, '')) THEN
      NEW.fonnte_id := NEW.wpp_id;
    ELSIF NEW.fonnte_id IS DISTINCT FROM OLD.fonnte_id AND NEW.fonnte_id IS NOT NULL
       AND (NEW.wpp_id IS NULL OR NEW.wpp_id = COALESCE(OLD.wpp_id, '')) THEN
      NEW.wpp_id := NEW.fonnte_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_whatsapp_messages_wpp_id ON public.whatsapp_messages;
CREATE TRIGGER trg_sync_whatsapp_messages_wpp_id
BEFORE INSERT OR UPDATE OF fonnte_id, wpp_id ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_whatsapp_messages_wpp_id();

-- ── 3. RPC save_outbound_whatsapp — tambah p_wpp_id (kompatibel mundur) ────
CREATE OR REPLACE FUNCTION public.save_outbound_whatsapp(
  p_thread_id uuid,
  p_body      text,
  p_metadata  jsonb DEFAULT NULL::jsonb,
  p_fonnte_id text  DEFAULT NULL::text,
  p_wpp_id    text  DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
  v_id text := COALESCE(p_wpp_id, p_fonnte_id);
BEGIN
  INSERT INTO public.whatsapp_messages (thread_id, direction, body, metadata, fonnte_id, wpp_id)
  VALUES (p_thread_id, 'out', p_body, p_metadata, v_id, v_id)
  RETURNING id INTO v_message_id;

  UPDATE public.whatsapp_threads SET
    last_message_preview = LEFT(p_body, 120),
    last_message_at      = now(),
    unread_count         = 0
  WHERE id = p_thread_id;

  RETURN v_message_id;
END;
$$;

-- ── 4. RPC get_autoreply_context — sertakan wpp_token di hasil ─────────────
CREATE OR REPLACE FUNCTION public.get_autoreply_context(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  FROM whatsapp_threads
  WHERE phone = p_phone
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(wpp_token, fonnte_token, ''),
         COALESCE(ai_lab_config, '{}'),
         smart_delay_config
    INTO v_wpp_token, v_ai_lab_config, v_smart_delay_cfg
  FROM properties
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
    FROM   whatsapp_messages
    WHERE  thread_id = v_thread_id
    ORDER  BY sent_at DESC
    LIMIT  30
  ) sub;

  RETURN jsonb_build_object(
    'thread_id',               v_thread_id,
    'auto_reply_enabled',      v_auto_reply,
    -- Kunci lama tetap ada agar kode belum-berpindah masih jalan.
    'fonnte_token',            v_wpp_token,
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

-- ── 5. get_public_property — strip juga wpp_token ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_property()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p)
       - 'google_places_api_key'
       - 'ai_api_key'
       - 'ai_base_url'
       - 'ai_model'
       - 'ai_lab_config'
       - 'fonnte_token'
       - 'wpp_token'
       - 'smart_delay_config'
       - 'payment_bank_name'
       - 'payment_account_number'
       - 'payment_account_holder'
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;