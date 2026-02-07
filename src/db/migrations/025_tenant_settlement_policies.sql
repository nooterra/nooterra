-- v1.18: tenant-level settlement policy registry (versioned, hash-pinned policy + verification method pairs).

CREATE TABLE IF NOT EXISTS tenant_settlement_policies (
  tenant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version BIGINT NOT NULL,
  policy_hash TEXT NOT NULL,
  verification_method_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, policy_id, policy_version)
);

CREATE INDEX IF NOT EXISTS tenant_settlement_policies_by_tenant_policy_updated
  ON tenant_settlement_policies (tenant_id, policy_id, updated_at DESC, policy_version DESC);

CREATE INDEX IF NOT EXISTS tenant_settlement_policies_by_tenant_updated
  ON tenant_settlement_policies (tenant_id, updated_at DESC, policy_id ASC, policy_version DESC);
