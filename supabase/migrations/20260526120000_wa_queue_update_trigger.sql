-- Re-fire queue worker when smart-delay extends process_after (UPDATE path).
-- INSERT-only trigger misses debounced bursts after the first message.

CREATE OR REPLACE FUNCTION public.trigger_process_wa_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://pomahguesthouse.com/api/queue-worker',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', row_to_json(NEW)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_process_wa_queue_update ON public.wa_conversation_queue;

CREATE TRIGGER t_process_wa_queue_update
AFTER UPDATE OF process_after ON public.wa_conversation_queue
FOR EACH ROW
WHEN (
  NEW.status IN ('pending', 'waiting')
  AND OLD.process_after IS DISTINCT FROM NEW.process_after
)
EXECUTE FUNCTION public.trigger_process_wa_queue();
