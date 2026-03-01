# Project.v1

`Project.v1` is the optional deterministic container for grouping state checkpoints and artifact lineage under a stable project boundary.

Runtime status: spec published. Runtime v1 consumes project identity through `StateCheckpoint.v1.projectId` and checkpoint query filters; standalone project CRUD endpoints are not implemented in API v1.

## Purpose

Provide a portable project envelope for state handoff workflows:

- stable grouping key for related checkpoints/artifacts
- deterministic scope boundary for list/export operations
- canonical hash binding for tamper-evident project metadata

## Required fields

- `schemaVersion` (const: `Project.v1`)
- `projectId`
- `tenantId`
- `ownerAgentId`
- `createdAt`
- `updatedAt`
- `revision` (non-negative integer)
- `projectHash` (canonical `sha256` over project body with `projectHash: null`)

## Key optional fields

- `displayName`
- `description`
- `sessionId`
- `traceId`
- `parentProjectId`
- `redactionPolicyRef`
- `metadata`

## Invariants

- `projectId` is a stable logical identity (`stateCheckpoint.projectId` references this value by exact string match).
- `tenantId` and `ownerAgentId` are required non-empty strings.
- `createdAt` and `updatedAt` must be valid ISO date-time strings.
- `revision` must be a non-negative safe integer.
- `projectHash` must re-compute exactly from canonical content.
- missing project containers must not weaken checkpoint safety; checkpoint creation/validation remains fail-closed on artifact/hash/grant invariants.

## Canonicalization guidance

- normalize content with canonical JSON rules (`src/core/canonical-json.js`) before hashing.
- trim identifier strings and normalize absent optional fields to `null`.
- compute `projectHash` as canonical `sha256` over the normalized object with `projectHash` omitted.

## API surface

- no standalone `/projects` endpoint in API v1.
- project scoping is currently exercised via state checkpoint APIs:
  - `POST /state-checkpoints` (`projectId` on create payload)
  - `GET /state-checkpoints?projectId=...` (exact-match filter)

## MCP surface

- no standalone project tool in v1.
- project identity is consumed indirectly by state checkpoint tools.

## Implementation references

- `src/core/state-checkpoint.js`
- `src/core/canonical-json.js`
- `src/api/app.js`
- `src/api/store.js`
- `src/db/store-pg.js`
- `test/state-checkpoint.test.js`
- `test/api-e2e-state-checkpoints.test.js`
- `test/pg-state-checkpoints.test.js`
