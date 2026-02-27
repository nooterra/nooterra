-- AgentCard.v1 discovery acceleration indexes for PG-backed substrate flows.
-- Focuses on the existing snapshots aggregate storage model.

CREATE INDEX IF NOT EXISTS snapshots_agent_card_by_tenant_agent
  ON snapshots (tenant_id, aggregate_id)
  WHERE aggregate_type = 'agent_card';

CREATE INDEX IF NOT EXISTS snapshots_agent_card_public_by_tenant_agent
  ON snapshots (tenant_id, aggregate_id)
  WHERE aggregate_type = 'agent_card' AND lower(coalesce(snapshot_json->>'visibility', '')) = 'public';

CREATE INDEX IF NOT EXISTS snapshots_agent_card_visibility_status_runtime
  ON snapshots (
    lower(coalesce(snapshot_json->>'visibility', '')),
    lower(coalesce(snapshot_json->>'status', '')),
    lower(coalesce(snapshot_json->'host'->>'runtime', '')),
    tenant_id,
    aggregate_id
  )
  WHERE aggregate_type = 'agent_card';

CREATE INDEX IF NOT EXISTS snapshots_agent_card_capabilities_gin
  ON snapshots
  USING GIN (
    (CASE
      WHEN jsonb_typeof(snapshot_json->'capabilities') = 'array' THEN snapshot_json->'capabilities'
      ELSE '[]'::jsonb
    END)
  )
  WHERE aggregate_type = 'agent_card';

CREATE INDEX IF NOT EXISTS snapshots_agent_card_tools_gin
  ON snapshots
  USING GIN (
    (CASE
      WHEN jsonb_typeof(snapshot_json->'tools') = 'array' THEN snapshot_json->'tools'
      ELSE '[]'::jsonb
    END)
  )
  WHERE aggregate_type = 'agent_card';
