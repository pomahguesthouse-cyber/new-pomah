-- Follow-up proaktif untuk form booking sekali pakai.
--
-- Sebelumnya: `generate_booking_form` mengirim tautan ber-TTL 30 menit dan
-- memindahkan state ke AWAITING_FORM_SUBMISSION. Bila tamu tidak submit dan
-- tidak mengirim pesan lagi, token mati diam-diam dan percakapan berhenti
-- tanpa kesimpulan — fallback yang ada hanya reaktif (butuh pesan tamu).
--
-- Job ini memanggil /api/cron/booking-form-followup tiap menit:
--   * menit ke-10 → satu pengingat + tawaran melanjutkan via chat
--   * setelah expires_at → token ditandai expired, state kembali ke
--     COLLECTING_DATA, dan tamu diberi pesan lanjut-di-chat
--
-- Cadence 1 menit disamakan dengan `booking-stuck-monitor` dan
-- `wa-queue-safety-net`; handler keluar lebih awal bila tidak ada token
-- pending sehingga biaya per eksekusi mendekati nol.

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'booking-form-followup') THEN
    PERFORM cron.unschedule('booking-form-followup');
  END IF;

  PERFORM cron.schedule(
    'booking-form-followup',
    '* * * * *',  -- tiap menit
    $cron$
      SELECT net.http_post(
        url                  := 'https://pomahguesthouse.com/api/cron/booking-form-followup',
        headers              := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END $$;

-- Index pendukung fase NUDGE: token pending yang belum pernah di-nudge.
-- Predicate partial agar index tetap kecil (token pending hidup < 30 menit).
CREATE INDEX IF NOT EXISTS idx_booking_form_tokens_pending_reminder
  ON public.booking_form_tokens (created_at)
  WHERE status = 'pending' AND reminder_sent_at IS NULL;

-- Verifikasi manual:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'booking-form-followup';
--   SELECT status, count(*) FROM public.booking_form_tokens GROUP BY 1;
