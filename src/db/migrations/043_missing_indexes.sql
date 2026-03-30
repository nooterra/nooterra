-- Performance indexes identified in production audit

-- credit_transactions: FK index for cascade deletes
CREATE INDEX IF NOT EXISTS credit_tx_execution_id ON credit_transactions (execution_id);

-- worker_executions: status-based list queries
CREATE INDEX IF NOT EXISTS worker_executions_tenant_status ON worker_executions (tenant_id, status);

-- worker_executions: worker-specific queries
CREATE INDEX IF NOT EXISTS worker_executions_worker_status ON worker_executions (worker_id, status, started_at DESC);

-- auth_keys: active key lookups
CREATE INDEX IF NOT EXISTS auth_keys_active ON auth_keys (tenant_id, key_id) WHERE status = 'active';

-- signer_keys: active key lookups
CREATE INDEX IF NOT EXISTS signer_keys_active ON signer_keys (tenant_id, key_id) WHERE status = 'active';

-- artifacts: source event lookups
CREATE INDEX IF NOT EXISTS artifacts_source_event ON artifacts (tenant_id, source_event_id) WHERE source_event_id IS NOT NULL AND source_event_id <> '';

-- worker_approvals: pending approvals per tenant (for inbox view)
CREATE INDEX IF NOT EXISTS worker_approvals_pending ON worker_approvals (tenant_id, status, created_at DESC) WHERE status = 'pending';

-- worker_memory: per-worker memory lookups
CREATE INDEX IF NOT EXISTS worker_memory_worker ON worker_memory (worker_id, scope, key);
