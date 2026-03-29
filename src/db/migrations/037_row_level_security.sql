-- Row-Level Security policies for multi-tenant isolation.
-- Defense-in-depth: even if application code misses a WHERE tenant_id clause,
-- Postgres will enforce tenant isolation at the row level.
--
-- The application connects with a role that has the nooterra_app policy applied.
-- Before each request, SET LOCAL nooterra.current_tenant_id = '<tenant_id>'.

-- Enable RLS on all tenant-scoped tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE signer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_credits ENABLE ROW LEVEL SECURITY;

-- Create policies that enforce tenant_id matching
-- Using current_setting with a default so queries don't fail when the setting isn't set
-- (superuser/migration connections bypass RLS automatically)

CREATE POLICY tenant_isolation_jobs ON jobs
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_job_events ON job_events
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_contracts ON contracts
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_deliveries ON deliveries
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_outbox ON outbox
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_auth_keys ON auth_keys
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_signer_keys ON signer_keys
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_agents ON agents
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_sessions ON sessions
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_session_events ON session_events
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_workers ON workers
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_worker_executions ON worker_executions
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_worker_memory ON worker_memory
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_worker_approvals ON worker_approvals
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_tenant_credits ON tenant_credits
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));
