-- 035: Add LISTEN/NOTIFY for outbox processing
-- Replaces 250ms polling with event-driven notification.
-- The consumer LISTENs on 'outbox_ready' and wakes immediately on INSERT.
-- A slower fallback poll (5s) remains as a safety net.

CREATE OR REPLACE FUNCTION notify_outbox_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('outbox_ready', json_build_object(
    'topic', NEW.topic,
    'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$;

-- Only fire if the trigger doesn't already exist (idempotent migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'outbox_inserted'
  ) THEN
    CREATE TRIGGER outbox_inserted
      AFTER INSERT ON outbox
      FOR EACH ROW
      EXECUTE FUNCTION notify_outbox_ready();
  END IF;
END;
$$;

-- Also notify on worker_executions changes (for scheduler coordination)
CREATE OR REPLACE FUNCTION notify_execution_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pg_notify('execution_ready', json_build_object(
      'id', NEW.id,
      'worker_id', NEW.worker_id,
      'tenant_id', NEW.tenant_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'execution_queued'
  ) THEN
    CREATE TRIGGER execution_queued
      AFTER INSERT OR UPDATE ON worker_executions
      FOR EACH ROW
      EXECUTE FUNCTION notify_execution_ready();
  END IF;
END;
$$;

-- Notify when approvals are decided (for resuming paused executions)
CREATE OR REPLACE FUNCTION notify_approval_decided()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.decision IS NOT NULL AND NEW.decision != 'pending' THEN
    PERFORM pg_notify('approval_decided', json_build_object(
      'id', NEW.id,
      'worker_id', NEW.worker_id,
      'tenant_id', NEW.tenant_id,
      'decision', NEW.decision
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'approval_decided_notify'
  ) THEN
    CREATE TRIGGER approval_decided_notify
      AFTER UPDATE ON worker_approvals
      FOR EACH ROW
      EXECUTE FUNCTION notify_approval_decided();
  END IF;
END;
$$;
