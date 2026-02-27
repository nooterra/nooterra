# StateCheckpoint.v1

`StateCheckpoint.v1` is the deterministic state handoff object for cross-agent continuity.

Runtime status: implemented.

## Purpose

Capture durable state snapshots and diffs as hash-bound references so agents can safely hand off context across sessions/tasks.

## Required fields

- `schemaVersion` (const: `StateCheckpoint.v1`)
- `checkpointId`
- `tenantId`
- `ownerAgentId`
- `stateRef` (`ArtifactRef.v1`)
- `diffRefs` (array, may be empty)
- `createdAt`
- `updatedAt`
- `revision` (non-negative integer)
- `checkpointHash` (canonical `sha256` over checkpoint body with `checkpointHash: null`)

## Key optional fields

- `projectId`
- `sessionId`
- `traceId`
- `parentCheckpointId`
- `delegationGrantRef`
- `authorityGrantRef`
- `redactionPolicyRef`
- `metadata`

## Invariants

- `stateRef.artifactHash` and each `diffRefs[].artifactHash` must be valid `sha256` hex.
- `diffRefs` are de-duplicated and deterministically ordered.
- `checkpointHash` must re-compute exactly from canonical content.
- when provided, `delegationGrantRef` and `authorityGrantRef` must be syntactically valid grant IDs.
- checkpoints are immutable by id in API v1 (create-once semantics; duplicate id conflicts).
- identity continuity paths must fail closed when signer lifecycle is non-active (`rotated`, `revoked`) for portability-linked artifacts.

## API surface

- `POST /state-checkpoints`
- `GET /state-checkpoints`
- `GET /state-checkpoints/:checkpointId`

## MCP surface

- `nooterra.state_checkpoint_create`
- `nooterra.state_checkpoint_list`
- `nooterra.state_checkpoint_get`

## Implementation references

- `src/core/state-checkpoint.js`
- `src/core/artifact-ref.js`
- `src/services/identity/signer-lifecycle.js`
- `src/api/app.js`
- `src/db/store-pg.js`
