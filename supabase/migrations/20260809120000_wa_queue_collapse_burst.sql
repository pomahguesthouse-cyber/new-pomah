-- ============================================================
-- Collapse a burst of queue entries for one phone into ONE reply
-- ============================================================
--
-- Bug (insiden 9 Agu 2026, transcript 6281210853153):
--   wa_queue_upsert HANYA menggabungkan entry berstatus 'pending'/'waiting'.
--   Begitu entry pertama masuk status 'processing', pesan tamu berikutnya
--   membuat entry BARU. Guard per-phone di wa_queue_claim_next hanya mencegah
--   dua worker jalan BERSAMAAN — ia tidak mencegah entry kedua diproses
--   SETELAH entry pertama selesai. Hasilnya: satu burst tamu ("yang ini bisa
--   berapa orang ya" + "harganya berapa ya ka") dibalas DUA kali oleh dua
--   agent berbeda, dengan isi yang saling bertentangan.
--
-- Fix: saat klaim, gabungkan SELURUH entry yang sudah siap untuk nomor itu
--   ke dalam entry tertua:
--     - message_count  = jumlah seluruh entry yang digabung
--     - last_message_body = body dari entry TERBARU (pesan terakhir tamu)
--     - sibling ditandai status 'merged' (terminal, tidak pernah diproses lagi)
--   Worker tetap membaca riwayat lengkap dari get_autoreply_context, jadi
--   seluruh pesan burst tetap terjawab — hanya dalam SATU balasan.
--
-- Catatan: 'merged' ditambahkan ke CHECK constraint sebagai status terminal
--   yang berbeda dari 'sent' supaya observability tetap jujur (entry ini tidak
--   pernah menghasilkan balasan sendiri).
-- ============================================================

-- 1. Izinkan status terminal baru 'merged'.
ALTER TABLE public.wa_conversation_queue
  DROP CONSTRAINT IF EXISTS wa_conversation_queue_status_check;

ALTER TABLE public.wa_conversation_queue
  ADD CONSTRAINT wa_conversation_queue_status_check
  CHECK (status IN ('pending','waiting','processing','sent','failed','retrying','merged'));

-- 2. Klaim yang menggabungkan burst.
CREATE OR REPLACE FUNCTION public.wa_queue_claim_next(p_worker_id text)
RETURNS TABLE(
  entry_id          uuid,
  phone             text,
  thread_id         uuid,
  message_count     integer,
  last_message_body text,
  attempt           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id        uuid;
  v_phone           text;
  v_merged_count    integer;
  v_latest_body     text;
  v_latest_msg_id   uuid;
BEGIN
  -- ── Pilih entry tertua yang siap, satu per nomor ────────────────────────
  SELECT q.id, q.phone
  INTO   v_entry_id, v_phone
  FROM   public.wa_conversation_queue q
  WHERE  (
           (q.status IN ('pending', 'waiting') AND q.process_after <= now())
        OR (q.status = 'retrying'              AND q.next_retry_at <= now())
         )
    AND  pg_try_advisory_xact_lock(hashtext('wa_queue_claim_next:' || q.phone)::bigint)
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.wa_conversation_queue active
           WHERE  active.phone = q.phone
             AND  active.status = 'processing'
             AND  active.lock_expires_at > now()
         )
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.wa_conversation_queue older
           WHERE  older.phone = q.phone
             AND  older.id <> q.id
             AND  (
                    (older.status IN ('pending', 'waiting') AND older.process_after <= now())
                 OR (older.status = 'retrying'              AND older.next_retry_at <= now())
                  )
             AND  (older.process_after, older.created_at, older.id)
                  < (q.process_after, q.created_at, q.id)
         )
  ORDER  BY q.process_after ASC
  FOR UPDATE SKIP LOCKED
  LIMIT  1;

  IF v_entry_id IS NULL THEN
    RETURN;
  END IF;

  -- ── Gabungkan SEMUA entry lain untuk nomor ini ke entry terpilih ────────
  -- Termasuk entry yang belum lewat process_after: pesan-pesan itu sudah
  -- masuk riwayat thread dan akan ikut terjawab oleh balasan ini, jadi
  -- membiarkannya hidup hanya menghasilkan balasan kedua yang mubazir.
  WITH siblings AS (
    UPDATE public.wa_conversation_queue s
    SET
      status       = 'merged',
      last_error   = 'merged_into:' || v_entry_id::text,
      completed_at = now(),
      updated_at   = now()
    WHERE  s.phone  = v_phone
      AND  s.id    <> v_entry_id
      AND  s.status IN ('pending', 'waiting', 'retrying')
    RETURNING s.message_count, s.last_message_body, s.last_message_id, s.created_at
  )
  SELECT
    COALESCE(SUM(sib.message_count), 0)::integer,
    (ARRAY_AGG(sib.last_message_body ORDER BY sib.created_at DESC))[1],
    (ARRAY_AGG(sib.last_message_id   ORDER BY sib.created_at DESC))[1]
  INTO v_merged_count, v_latest_body, v_latest_msg_id
  FROM siblings sib;

  -- ── Klaim entry terpilih dengan hitungan burst yang sudah digabung ──────
  RETURN QUERY
  UPDATE public.wa_conversation_queue q
  SET
    status            = 'processing',
    worker_id         = p_worker_id,
    started_at        = now(),
    locked_at         = now(),
    lock_expires_at   = now() + interval '120 seconds',
    heartbeat_at      = now(),
    attempt           = q.attempt + 1,
    message_count     = q.message_count + COALESCE(v_merged_count, 0),
    last_message_body = COALESCE(v_latest_body, q.last_message_body),
    last_message_id   = COALESCE(v_latest_msg_id, q.last_message_id),
    updated_at        = now()
  WHERE q.id = v_entry_id
  RETURNING q.id, q.phone, q.thread_id, q.message_count, q.last_message_body, q.attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_queue_claim_next(text) TO service_role;

-- 3. Entry yang di-upsert saat nomor sedang 'processing' tetap membuat baris
--    baru (itu benar — pesan barunya nyata), tapi beri jeda minimum supaya
--    tidak langsung diklaim detik berikutnya sebelum balasan pertama terkirim.
--    Tanpa ini, collapse di atas tidak sempat menangkapnya.
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
