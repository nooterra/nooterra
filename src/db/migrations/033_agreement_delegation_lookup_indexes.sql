-- AgreementDelegation.v1 snapshot lookup acceleration for parent/child agreement lineage scans.
-- Mirrors API list filters: tenant + parent/child hash + optional status + deterministic aggregate_id ordering.

CREATE INDEX IF NOT EXISTS snapshots_agreement_delegation_parent_status_aggregate
  ON snapshots (
    tenant_id,
    lower(coalesce(snapshot_json->>'parentAgreementHash', '')),
    lower(coalesce(snapshot_json->>'status', '')),
    aggregate_id
  )
  WHERE aggregate_type = 'agreement_delegation';

CREATE INDEX IF NOT EXISTS snapshots_agreement_delegation_child_status_aggregate
  ON snapshots (
    tenant_id,
    lower(coalesce(snapshot_json->>'childAgreementHash', '')),
    lower(coalesce(snapshot_json->>'status', '')),
    aggregate_id
  )
  WHERE aggregate_type = 'agreement_delegation';
