-- Tambah trigger_type 'needs_human' ke conversation_alerts.
--
-- Latar: field chat_summary_json.needs_human diisi LLM summarizer tapi tidak
-- pernah memicu apa pun di jalur bot — hanya terlihat di panel admin bila
-- kebetulan dibuka. Kini conversation-monitor mengirim alert (Telegram +
-- dashboard) saat summary menandai tamu butuh manusia, dengan dedup bawaan
-- (satu alert 'open' per thread per tipe).

ALTER TABLE public.conversation_alerts
  DROP CONSTRAINT IF EXISTS conversation_alerts_trigger_type_check;

ALTER TABLE public.conversation_alerts
  ADD CONSTRAINT conversation_alerts_trigger_type_check
  CHECK (trigger_type IN (
    'repetitive',
    'escalation',
    'unresponsive',
    'fallback_loop',
    'keyword',
    'manual',
    'needs_human'   -- summary LLM menandai tamu butuh penanganan manusia
  ));
