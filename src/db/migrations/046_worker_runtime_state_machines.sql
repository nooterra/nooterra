-- 046: Enforce hosted worker execution + approval state machines.
--
-- Runtime logic has accumulated several execution and approval statuses.
-- These triggers make illegal transitions fail closed at the database layer.

ALTER TABLE worker_executions
  DROP CONSTRAINT IF EXISTS worker_executions_status_valid;

ALTER TABLE worker_executions
  ADD CONSTRAINT worker_executions_status_valid
  CHECK (status IN (
    'queued',
    'running',
    'awaiting_approval',
    'completed',
    'shadow_completed',
    'failed',
    'charter_blocked',
    'budget_exceeded',
    'auto_paused',
    'error',
    'billing_error',
    'rate_limited',
    'skipped'
  )) NOT VALID;

ALTER TABLE worker_approvals
  DROP CONSTRAINT IF EXISTS worker_approvals_status_valid;

ALTER TABLE worker_approvals
  ADD CONSTRAINT worker_approvals_status_valid
  CHECK (status IN ('pending', 'approved', 'denied', 'resumed', 'edited', 'timeout')) NOT VALID;

ALTER TABLE worker_approvals
  DROP CONSTRAINT IF EXISTS worker_approvals_decision_valid;

ALTER TABLE worker_approvals
  ADD CONSTRAINT worker_approvals_decision_valid
  CHECK (decision IS NULL OR decision IN ('approved', 'denied', 'edited', 'timeout')) NOT VALID;

ALTER TABLE worker_approvals
  DROP CONSTRAINT IF EXISTS worker_approvals_status_decision_valid;

ALTER TABLE worker_approvals
  ADD CONSTRAINT worker_approvals_status_decision_valid
  CHECK (
    (status = 'pending' AND decision IS NULL)
    OR (status = 'approved' AND decision = 'approved')
    OR (status = 'resumed' AND decision = 'approved')
    OR (status = 'denied' AND decision = 'denied')
    OR (status = 'edited' AND decision = 'edited')
    OR (status = 'timeout' AND decision = 'timeout')
  ) NOT VALID;

CREATE OR REPLACE FUNCTION guard_worker_execution_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('queued', 'running') THEN
      RAISE EXCEPTION 'invalid worker_executions insert status: %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'queued' AND NEW.status IN ('running', 'failed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'running' AND NEW.status IN (
    'queued',
    'awaiting_approval',
    'completed',
    'shadow_completed',
    'failed',
    'charter_blocked',
    'budget_exceeded',
    'auto_paused',
    'error',
    'billing_error',
    'rate_limited',
    'skipped'
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'awaiting_approval' AND NEW.status IN ('running', 'failed', 'charter_blocked') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid worker_executions status transition: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_worker_execution_transition ON worker_executions;
CREATE TRIGGER trg_guard_worker_execution_transition
  BEFORE INSERT OR UPDATE OF status ON worker_executions
  FOR EACH ROW
  EXECUTE FUNCTION guard_worker_execution_transition();

CREATE OR REPLACE FUNCTION guard_worker_approval_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (NEW.status = 'pending' AND NEW.decision IS NULL)
    OR (NEW.status = 'approved' AND NEW.decision = 'approved')
    OR (NEW.status = 'resumed' AND NEW.decision = 'approved')
    OR (NEW.status = 'denied' AND NEW.decision = 'denied')
    OR (NEW.status = 'edited' AND NEW.decision = 'edited')
    OR (NEW.status = 'timeout' AND NEW.decision = 'timeout')
  ) THEN
    RAISE EXCEPTION 'invalid worker_approvals status/decision combination: status=%, decision=%', NEW.status, NEW.decision;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'invalid worker_approvals insert status: %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'denied', 'edited', 'timeout') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'resumed' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid worker_approvals status transition: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_worker_approval_transition ON worker_approvals;
CREATE TRIGGER trg_guard_worker_approval_transition
  BEFORE INSERT OR UPDATE OF status, decision ON worker_approvals
  FOR EACH ROW
  EXECUTE FUNCTION guard_worker_approval_transition();
