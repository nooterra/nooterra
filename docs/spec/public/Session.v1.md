# Session.v1

`Session.v1` is the durable collaboration container for agent-to-agent coordination.

Runtime status: implemented.

## Purpose

A session provides a stable context boundary for participants, policy linkage, and append-only `SessionEvent` timelines.

## Required fields

- `schemaVersion` (const: `Session.v1`)
- `sessionId`
- `tenantId`
- `visibility` (`public|tenant|private`)
- `participants` (non-empty, de-duplicated, sorted)
- `createdAt` (ISO datetime)
- `updatedAt` (ISO datetime)
- `revision` (non-negative integer)

## Key optional fields

- `policyRef`
- `metadata`

## Invariants

- `participants` must include at least one agent id.
- `visibility` must be one of `public`, `tenant`, or `private`.
- `revision` starts at `0` and increments on each successful event append.
- canonical normalization is used for deterministic hashing/replay workflows.

## API surface

- `POST /sessions`
- `GET /sessions`
- `GET /sessions/:sessionId`

## MCP surface

- `settld.session_create`
- `settld.session_list`
- `settld.session_get`

## Implementation references

- `src/core/session-collab.js`
- `src/api/app.js`
- `src/api/openapi.js`

