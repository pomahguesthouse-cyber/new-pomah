-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create or replace the function to trigger the queue worker via pg_net
CREATE OR REPLACE FUNCTION public.trigger_process_wa_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://new-pomah.lovable.app/api/queue-worker',
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

-- Drop trigger if it exists to allow recreation
DROP TRIGGER IF EXISTS t_process_wa_queue ON public.wa_conversation_queue;

-- Create the trigger on wa_conversation_queue
-- We trigger it AFTER INSERT to signal the worker there's a new job.
CREATE TRIGGER t_process_wa_queue
AFTER INSERT ON public.wa_conversation_queue
FOR EACH ROW
EXECUTE FUNCTION public.trigger_process_wa_queue();

-- For retry scenarios or delayed processes, you can optionally add UPDATE triggers.
-- For now, INSERT is the primary entry point.
