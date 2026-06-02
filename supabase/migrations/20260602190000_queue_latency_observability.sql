-- ============================================================
-- Queue Latency & LLM Duration Stats View
-- ============================================================
--
-- Computes hourly percentiles (p50/p95/p99) for queue wait times and LLM call durations
-- along with zombie timeout statistics.
-- ============================================================

CREATE OR REPLACE VIEW public.wa_queue_latency_stats WITH (security_invoker=on) AS
SELECT
  date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta') AS hour_wib,
  COUNT(*) AS total_bursts,
  COUNT(*) FILTER (WHERE status = 'sent') AS sent,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
  COUNT(*) FILTER (WHERE status = 'processing') AS processing,
  COUNT(*) FILTER (WHERE status IN ('pending', 'waiting')) AS queued,
  
  -- Zombie timeout tracking
  COUNT(*) FILTER (WHERE last_error LIKE '%zombie_timeout%') AS zombie_timeouts,
  COUNT(*) FILTER (WHERE status = 'failed' AND last_error LIKE '%zombie_timeout%') AS failed_zombies,
  COUNT(*) FILTER (WHERE status = 'retrying' AND last_error LIKE '%zombie_timeout%') AS retrying_zombies,
  COUNT(*) FILTER (WHERE last_error LIKE '%max_wait_exceeded%') AS max_wait_exceeded_count,
  
  -- Queue latency percentiles (seconds)
  COALESCE((percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (started_at - created_at))))::float, 0.0) AS queue_latency_p50_sec,
  COALESCE((percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (started_at - created_at))))::float, 0.0) AS queue_latency_p95_sec,
  COALESCE((percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (started_at - created_at))))::float, 0.0) AS queue_latency_p99_sec,
  
  -- LLM call duration percentiles (seconds)
  COALESCE((percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (completed_at - started_at))))::float, 0.0) AS llm_duration_p50_sec,
  COALESCE((percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (completed_at - started_at))))::float, 0.0) AS llm_duration_p95_sec,
  COALESCE((percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (completed_at - started_at))))::float, 0.0) AS llm_duration_p99_sec,
  
  -- Average scheduler delay (started_at - process_after)
  COALESCE(ROUND(AVG(EXTRACT(epoch FROM (started_at - process_after))))::int, 0) AS avg_scheduler_delay_sec
FROM public.wa_conversation_queue
GROUP BY hour_wib
ORDER BY hour_wib DESC;

-- Grants
GRANT SELECT ON public.wa_queue_latency_stats TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
