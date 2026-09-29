-- wa_queue_upsert idempoten terhadap p_message_id.
-- Basis: 20260809120000_wa_queue_collapse_burst.sql (versi terakhir fungsi ini).
-- Satu-satunya perubahan: pemeriksaan last_message_id di awal fungsi.

CREATE INDEX IF NOT EXISTS wa_conversation_queue_last_message_id_idx
  ON public.wa_conversation_queue (last_message_id)
  WHERE last_message_id IS NOT NULL;

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
SET search_path = public
AS $$
DECLARE
  v_existing_id       uuid;
  v_max_wait_until    timestamptz;
  v_new_process_after timestamptz;
  v_sleep_ms          integer;
  v_processing_until  timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wa_queue_upsert:' || p_phone)::bigint);

  -- Idempoten per pesan: pesan yang SUDAH punya baris antrian (status apa pun,
  -- termasuk 'sent' dan 'merged') tidak boleh membuka burst baru. Insiden
  -- 16 Sep 2026: tiap pesan tamu diantrikan dua kali (±25–45 detik setelah
  -- balasan pertama terkirim) dengan last_message_id yang sama, sehingga tamu
  -- menerima dua balasan berbeda untuk satu pertanyaan.
  IF p_message_id IS NOT NULL THEN
    SELECT q.id INTO v_existing_id
    FROM   wa_conversation_queue q
    WHERE  q.last_message_id = p_message_id
    ORDER  BY q.created_at DESC
    LIMIT  1;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing_id, 0, false;
      RETURN;
    END IF;
  END IF;

  SELECT q.id, q.max_wait_until
  INTO   v_existing_id, v_max_wait_until
  FROM   wa_conversation_queue q
  WHERE  q.phone  = p_phone
    AND  q.status IN ('pending', 'waiting')
  ORDER  BY q.created_at DESC
  LIMIT  1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    v_new_process_after := LEAST(
      now() + make_interval(secs => p_delay_ms::float / 1000.0),
      v_max_wait_until
    );

    UPDATE wa_conversation_queue
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
    -- Ada worker yang sedang membalas nomor ini? Jangan jadwalkan entry baru
    -- lebih cepat dari sisa lock-nya: balasan yang sedang disusun sudah
    -- membaca pesan ini dari riwayat thread. Setelah worker selesai, collapse
    -- di wa_queue_claim_next akan menggabungkan sisa burst jadi satu balasan.
    SELECT MAX(p.lock_expires_at)
    INTO   v_processing_until
    FROM   wa_conversation_queue p
    WHERE  p.phone  = p_phone
      AND  p.status = 'processing'
      AND  p.lock_expires_at > now();

    v_new_process_after := now() + make_interval(secs => p_delay_ms::float / 1000.0);
    v_max_wait_until    := now() + make_interval(secs => p_max_wait_ms::float / 1000.0);
    v_new_process_after := LEAST(v_new_process_after, v_max_wait_until);

    IF v_processing_until IS NOT NULL THEN
      -- Jangan lewati max_wait_until — cukup tunda sampai worker aktif selesai
      -- (plus 2 detik jeda) atau sampai batas sabar burst, mana yang lebih awal.
      v_new_process_after := LEAST(
        GREATEST(v_new_process_after, v_processing_until + interval '2 seconds'),
        v_max_wait_until
      );
    END IF;

    INSERT INTO wa_conversation_queue (
      phone, thread_id, last_message_id, last_message_body,
      process_after, max_wait_until, status, message_count
    ) VALUES (
      p_phone, p_thread_id, p_message_id, p_body,
      v_new_process_after, v_max_wait_until, 'pending', 1
    )
    RETURNING id INTO v_existing_id;

    v_sleep_ms := GREATEST(0,
      EXTRACT(EPOCH FROM (v_new_process_after - now()))::float * 1000
    )::integer;

    RETURN QUERY SELECT v_existing_id, v_sleep_ms, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_upsert(text, uuid, uuid, text, integer, integer) TO service_role;