-- Notify the runtime immediately when an execution is queued.
-- This replaces the 10-second poll for webhook/manual triggers.

CREATE OR REPLACE FUNCTION notify_execution_queued() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pg_notify('execution_queued', json_build_object(
      'execution_id', NEW.id,
      'worker_id', NEW.worker_id,
      'tenant_id', NEW.tenant_id,
      'trigger_type', NEW.trigger_type
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_queued ON worker_executions;
CREATE TRIGGER trg_execution_queued
  AFTER INSERT ON worker_executions
  FOR EACH ROW EXECUTE FUNCTION notify_execution_queued();
