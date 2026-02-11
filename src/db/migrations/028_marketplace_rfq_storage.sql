-- v1.21: hard-cut marketplace storage naming from task* to rfq*.

DO $$
BEGIN
  IF to_regclass('marketplace_rfqs') IS NULL AND to_regclass('marketplace_tasks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE marketplace_tasks RENAME TO marketplace_rfqs';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_rfq_bids') IS NULL AND to_regclass('marketplace_task_bids') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE marketplace_task_bids RENAME TO marketplace_rfq_bids';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_rfqs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'marketplace_rfqs' AND column_name = 'task_id'
    ) THEN
      EXECUTE 'ALTER TABLE marketplace_rfqs RENAME COLUMN task_id TO rfq_id';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'marketplace_rfqs' AND column_name = 'task_json'
    ) THEN
      EXECUTE 'ALTER TABLE marketplace_rfqs RENAME COLUMN task_json TO rfq_json';
    END IF;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_rfq_bids') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'marketplace_rfq_bids' AND column_name = 'task_id'
    ) THEN
      EXECUTE 'ALTER TABLE marketplace_rfq_bids RENAME COLUMN task_id TO rfq_id';
    END IF;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_rfqs') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE marketplace_rfqs
      SET rfq_json = jsonb_set(rfq_json - 'taskId', '{rfqId}', to_jsonb(rfq_id), true)
      WHERE (rfq_json ? 'taskId') OR NOT (rfq_json ? 'rfqId')
    $sql$;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_rfq_bids') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE marketplace_rfq_bids
      SET bid_json = jsonb_set(bid_json - 'taskId', '{rfqId}', to_jsonb(rfq_id), true)
      WHERE (bid_json ? 'taskId') OR NOT (bid_json ? 'rfqId')
    $sql$;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('marketplace_tasks_by_tenant_status_created') IS NOT NULL
     AND to_regclass('marketplace_rfqs_by_tenant_status_created') IS NULL THEN
    EXECUTE 'ALTER INDEX marketplace_tasks_by_tenant_status_created RENAME TO marketplace_rfqs_by_tenant_status_created';
  END IF;

  IF to_regclass('marketplace_tasks_by_tenant_capability_status_created') IS NOT NULL
     AND to_regclass('marketplace_rfqs_by_tenant_capability_status_created') IS NULL THEN
    EXECUTE 'ALTER INDEX marketplace_tasks_by_tenant_capability_status_created RENAME TO marketplace_rfqs_by_tenant_capability_status_created';
  END IF;

  IF to_regclass('marketplace_tasks_by_tenant_poster_status_created') IS NOT NULL
     AND to_regclass('marketplace_rfqs_by_tenant_poster_status_created') IS NULL THEN
    EXECUTE 'ALTER INDEX marketplace_tasks_by_tenant_poster_status_created RENAME TO marketplace_rfqs_by_tenant_poster_status_created';
  END IF;

  IF to_regclass('marketplace_task_bids_by_task_status_amount_created') IS NOT NULL
     AND to_regclass('marketplace_rfq_bids_by_rfq_status_amount_created') IS NULL THEN
    EXECUTE 'ALTER INDEX marketplace_task_bids_by_task_status_amount_created RENAME TO marketplace_rfq_bids_by_rfq_status_amount_created';
  END IF;

  IF to_regclass('marketplace_task_bids_by_task_bidder_status') IS NOT NULL
     AND to_regclass('marketplace_rfq_bids_by_rfq_bidder_status') IS NULL THEN
    EXECUTE 'ALTER INDEX marketplace_task_bids_by_task_bidder_status RENAME TO marketplace_rfq_bids_by_rfq_bidder_status';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS marketplace_rfqs_by_tenant_status_created
  ON marketplace_rfqs (tenant_id, status, created_at DESC, rfq_id DESC);

CREATE INDEX IF NOT EXISTS marketplace_rfqs_by_tenant_capability_status_created
  ON marketplace_rfqs (tenant_id, capability, status, created_at DESC, rfq_id DESC);

CREATE INDEX IF NOT EXISTS marketplace_rfqs_by_tenant_poster_status_created
  ON marketplace_rfqs (tenant_id, poster_agent_id, status, created_at DESC, rfq_id DESC);

CREATE INDEX IF NOT EXISTS marketplace_rfq_bids_by_rfq_status_amount_created
  ON marketplace_rfq_bids (tenant_id, rfq_id, status, amount_cents ASC, created_at ASC, bid_id ASC);

CREATE INDEX IF NOT EXISTS marketplace_rfq_bids_by_rfq_bidder_status
  ON marketplace_rfq_bids (tenant_id, rfq_id, bidder_agent_id, status, bid_id ASC);
