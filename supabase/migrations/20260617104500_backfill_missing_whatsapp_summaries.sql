-- Backfill older WhatsApp threads that never entered the LLM summary pipeline.
-- This fills empty chat_summary/chat_summary_json so Admin WhatsApp sidebars are no longer blank.

WITH latest_inbound AS (
  SELECT DISTINCT ON (thread_id)
    thread_id,
    body
  FROM public.whatsapp_messages
  WHERE direction = 'in'
  ORDER BY thread_id, sent_at DESC
), counts AS (
  SELECT
    thread_id,
    COUNT(*)::int AS message_count
  FROM public.whatsapp_messages
  GROUP BY thread_id
)
UPDATE public.whatsapp_threads wt
SET
  chat_summary = CASE
    WHEN COALESCE(li.body, wt.last_message_preview, '') <> ''
      THEN 'Percakapan WhatsApp aktif. Pesan terakhir tamu: ' || LEFT(COALESCE(li.body, wt.last_message_preview), 220)
    ELSE 'Percakapan WhatsApp aktif. Belum ada ringkasan detail.'
  END,
  chat_summary_json = jsonb_build_object(
    'source', 'backfill_auto',
    'short_summary', CASE
      WHEN COALESCE(li.body, wt.last_message_preview, '') <> ''
        THEN 'Percakapan WhatsApp aktif. Pesan terakhir tamu: ' || LEFT(COALESCE(li.body, wt.last_message_preview), 220)
      ELSE 'Percakapan WhatsApp aktif. Belum ada ringkasan detail.'
    END,
    'guest_name', wt.display_name,
    'last_topic', 'general',
    'room_type', NULL,
    'check_in', NULL,
    'check_out', NULL,
    'guest_count', NULL,
    'booking_status', NULL,
    'payment_status', NULL,
    'complaint_active', false,
    'unresolved_question', CASE WHEN COALESCE(li.body, '') LIKE '%?%' THEN LEFT(li.body, 240) ELSE NULL END,
    'needs_human', false,
    'handoff_reason', NULL
  ),
  chat_summary_version = COALESCE(wt.chat_summary_version, 0) + 1,
  chat_summary_updated_at = now()
FROM counts c
LEFT JOIN latest_inbound li ON li.thread_id = c.thread_id
WHERE wt.id = c.thread_id
  AND c.message_count >= 1
  AND (
    wt.chat_summary_updated_at IS NULL
    OR COALESCE(wt.chat_summary, '') = ''
    OR COALESCE(wt.chat_summary_json, '{}'::jsonb) = '{}'::jsonb
  );