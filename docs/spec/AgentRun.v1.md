# AgentRun.v1

`AgentRun.v1` defines a deterministic snapshot of a single autonomous run executed by a registered agent identity.

It is designed to be:

- portable across services and SDKs,
- reconstructable from an append-only event stream,
- directly consumable by verification and settlement workflows.

## Schema

See `schemas/AgentRun.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `AgentRun.v1`)
- `runId`
- `agentId`
- `tenantId`
- `status` (`created|running|completed|failed`)
- `createdAt`
- `updatedAt`

## Event-derived semantics

`AgentRun.v1` is treated as a derived snapshot from `AgentEvent.v1` events in the run stream.

- `created` is set by `RUN_CREATED`.
- `running` is set by `RUN_STARTED` (or heartbeat if started exists).
- `completed` is terminal and set by `RUN_COMPLETED`.
- `failed` is terminal and set by `RUN_FAILED`.

After a terminal state (`completed|failed`), non-terminal state transitions are invalid.

## Evidence linkage

`evidenceRefs` is an optional deterministic list of evidence references attached by events.
Each ref is an opaque string in v1; higher-level protocols may enforce path/hash semantics.

## Canonicalization and hashing

When hashed/signed by higher-level objects:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
