-- 044: Align hosted worker approval schema with scheduler runtime.
--
-- Fresh databases created from older migrations had a terminal-only
-- worker_approvals shape (decision/decided_at) while the hosted scheduler
-- evolved toward a pause/resume lifecycle (pending/approved/denied/resumed).
-- This migration makes the schema compatible with both analytics and runtime.

ALTER TABLE worker_approvals
  ADD COLUMN IF NOT EXISTS execution_id TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS matched_rule TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS action_hash TEXT;

-- Original migration 034 declared decision NOT NULL, but the hosted runtime
-- inserts 'pending' approvals with no decision yet. Relax the constraint.
ALTER TABLE worker_approvals ALTER COLUMN decision DROP NOT NULL;

UPDATE worker_approvals
SET status = CASE
  WHEN decision IS NULL OR decision = '' THEN COALESCE(status, 'pending')
  ELSE decision
END
WHERE status IS NULL OR status = '';

UPDATE worker_approvals
SET decision = CASE
  WHEN status IN ('approved', 'denied', 'edited', 'timeout') THEN status
  ELSE decision
END
WHERE decision IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_approvals'
      AND column_name = 'rule'
  ) THEN
    EXECUTE 'UPDATE worker_approvals SET matched_rule = COALESCE(matched_rule, rule) WHERE matched_rule IS NULL';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS worker_approvals_execution_status ON worker_approvals (execution_id, status);
CREATE INDEX IF NOT EXISTS worker_approvals_worker_decision ON worker_approvals (worker_id, decision, decided_at DESC);
CREATE INDEX IF NOT EXISTS worker_approvals_worker_matched_rule ON worker_approvals (worker_id, matched_rule, decided_at DESC);

CREATE OR REPLACE FUNCTION notify_approval_decided()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  effective_decision TEXT;
BEGIN
  effective_decision := COALESCE(NEW.decision, CASE
    WHEN NEW.status IN ('approved', 'denied', 'edited', 'timeout') THEN NEW.status
    ELSE NULL
  END);

  IF effective_decision IS NOT NULL THEN
    PERFORM pg_notify('approval_decided', json_build_object(
      'id', NEW.id,
      'worker_id', NEW.worker_id,
      'tenant_id', NEW.tenant_id,
      'decision', effective_decision
    )::text);
  END IF;

  RETURN NEW;
END;
$$;

-- Critical: the trigger function above was never attached. Create it now.
DROP TRIGGER IF EXISTS trg_approval_decided ON worker_approvals;
CREATE TRIGGER trg_approval_decided
  AFTER UPDATE OF decision, status ON worker_approvals
  FOR EACH ROW
  EXECUTE FUNCTION notify_approval_decided();

-- Backfill execution_id for historical approval rows by correlating
-- with executions on (worker_id, tenant_id) within a 5-minute window.
UPDATE worker_approvals wa
SET execution_id = sub.execution_id
FROM (
  SELECT DISTINCT ON (wa2.id) wa2.id AS approval_id, we.id AS execution_id
  FROM worker_approvals wa2
  JOIN worker_executions we
    ON we.worker_id = wa2.worker_id
   AND we.tenant_id = wa2.tenant_id
   AND we.started_at <= COALESCE(wa2.created_at, wa2.decided_at)
   AND COALESCE(wa2.created_at, wa2.decided_at) <= COALESCE(we.completed_at, we.started_at + INTERVAL '5 minutes')
  WHERE wa2.execution_id IS NULL
  ORDER BY wa2.id, we.started_at DESC
) sub
WHERE wa.id = sub.approval_id;
