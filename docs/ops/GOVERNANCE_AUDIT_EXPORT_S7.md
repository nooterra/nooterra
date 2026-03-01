# Governance Audit Export (S7)

## Purpose
Provide a deterministic, machine-readable governance audit export for emergency controls and authority/delegation operations.

## Endpoint
- `GET /ops/audit/export?domain=governance&limit=500&offset=0`

## Auth
- Requires `ops_read` scope.

## Determinism Contract
- Response schema: `OpsAuditExport.v1`
- Rows schema: `OpsAuditExportRow.v1`
- Rows are sorted deterministically by `at` ascending, then `auditId` ascending.
- Rows are hash-chained deterministically:
  - `row.prevRowHash` is `null` for the first row and the prior row hash otherwise.
  - `row.rowHash` is `sha256(canonical_json(row_without_rowHash + prevRowHash))`.
  - `rowChainHeadHash` equals the last row hash (or `null` for empty exports).
- `exportHash` is `sha256(canonical_json(export_without_hash))`.
- `generatedAt` is derived from data (`rows[last].at`) rather than wall-clock now.

## Fail-Closed Rules
- Export fails with `409 AUDIT_EXPORT_BLOCKED` if any included row is missing canonical `action` or `at`.
- Export fails with `409 AUDIT_EXPORT_REASON_CODE_REQUIRED` when `requireReasonCodes=true` (default) and a denial/control row is missing `reasonCode`.
- Export fails with `409 AUDIT_EXPORT_BINDING_REQUIRED` when governance-critical actions are missing required linked references:
  - `EMERGENCY_CONTROL_*` requires `linkedRefs.emergencyControlRef`.
  - `DELEGATION_GRANT_*` requires `linkedRefs.delegationGrantId`.
  - `AUTHORITY_GRANT_*` requires `linkedRefs.authorityGrantId`.

## Reason-Coded Denials
Denial/control outcomes (`denied`, `revoked`, `kill_switch`, `quarantine`, `paused`) must carry a reason code.

## Linked References
Each row includes normalized linked refs when available:
- `caseId`
- `receiptId`
- `runId`
- `gateId`
- `escalationId`
- `delegationGrantId`
- `authorityGrantId`
- `emergencyControlRef`
