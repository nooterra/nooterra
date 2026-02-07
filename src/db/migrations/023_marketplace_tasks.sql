-- v1.16: persist marketplace tasks and bids for cross-process durability.

CREATE TABLE IF NOT EXISTS marketplace_tasks (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  capability TEXT,
  poster_agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, task_id)
);

CREATE INDEX IF NOT EXISTS marketplace_tasks_by_tenant_status_created
  ON marketplace_tasks (tenant_id, status, created_at DESC, task_id DESC);

CREATE INDEX IF NOT EXISTS marketplace_tasks_by_tenant_capability_status_created
  ON marketplace_tasks (tenant_id, capability, status, created_at DESC, task_id DESC);

CREATE INDEX IF NOT EXISTS marketplace_tasks_by_tenant_poster_status_created
  ON marketplace_tasks (tenant_id, poster_agent_id, status, created_at DESC, task_id DESC);

CREATE TABLE IF NOT EXISTS marketplace_task_bids (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  bid_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  bidder_agent_id TEXT,
  amount_cents BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bid_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, task_id, bid_id),
  CONSTRAINT marketplace_task_bids_task_fkey
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES marketplace_tasks (tenant_id, task_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS marketplace_task_bids_by_task_status_amount_created
  ON marketplace_task_bids (tenant_id, task_id, status, amount_cents ASC, created_at ASC, bid_id ASC);

CREATE INDEX IF NOT EXISTS marketplace_task_bids_by_task_bidder_status
  ON marketplace_task_bids (tenant_id, task_id, bidder_agent_id, status, bid_id ASC);
