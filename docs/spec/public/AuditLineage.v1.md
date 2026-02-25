# AuditLineage.v1

`AuditLineage.v1` is a deterministic, hash-bound lineage export for cross-object ACS audit queries.

## Purpose

Provide one normalized response that can include records from multiple ACS object families (sessions/events, negotiation, work orders, settlements, arbitration, delegations) while remaining replayable and tamper-detectable.

## Schema

Top-level fields:

- `schemaVersion`: must be `AuditLineage.v1`
- `tenantId`: tenant scope
- `filters`: normalized query filters used to produce the lineage
- `summary`: deterministic pagination/count metadata
- `records`: ordered lineage records
- `lineageHash`: `sha256(canonicalJson(top-level object without lineageHash))`

Record fields:

- `kind`: object family (`SESSION`, `SESSION_EVENT`, `TASK_QUOTE`, `TASK_OFFER`, `TASK_ACCEPTANCE`, `WORK_ORDER`, `COMPLETION_RECEIPT`, `RUN`, `RUN_SETTLEMENT`, `ARBITRATION_CASE`, `AGREEMENT_DELEGATION`)
- `recordId`: stable object identifier
- `at`: primary timestamp (nullable ISO datetime)
- `status`: object status (nullable)
- `traceIds[]`: sorted trace identifiers
- `agentIds[]`: sorted agent identifiers
- `refs`: canonical reference payload

## Deterministic ordering

`records` must be sorted by:

1. `at` descending (null timestamps sort last)
2. `kind` ascending
3. `recordId` ascending

## Verification

Use the verifier to validate schema, summary consistency, deterministic order, and hash integrity:

- script: `node scripts/ops/verify-audit-lineage.mjs --in <lineage.json>`
- npm wrapper: `npm run -s ops:audit:lineage:verify -- --in <lineage.json>`

Input can be either:

- raw `AuditLineage.v1` object, or
- wrapper object containing `{ "lineage": { ... } }`

