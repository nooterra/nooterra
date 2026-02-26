# AgentEvent.v1

`AgentEvent.v1` defines the append-only run event envelope for autonomous agent execution traces.

Each event is scoped to one run stream (`streamId = runId`) and can be used to reconstruct `AgentRun.v1`.

## Schema

See `schemas/AgentEvent.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `AgentEvent.v1`)
- `v` (event version, const `1`)
- `id`
- `streamId` (run ID)
- `type`
- `at` (ISO date-time)
- `actor` (`type` + `id`)
- `payload`

## Allowed event types (v1)

- `RUN_CREATED`
- `RUN_STARTED`
- `RUN_HEARTBEAT`
- `EVIDENCE_ADDED`
- `RUN_COMPLETED`
- `RUN_FAILED`

## Signature and chain fields

The following fields are optional in `AgentEvent.v1` but reserved for signed chain envelopes:

- `payloadHash`
- `prevChainHash`
- `chainHash`
- `signature`
- `signerKeyId`

If present, these fields must be verifiable using the same hash/signature model used by Nooterra chained events.

## Determinism

Event application order is stream order.

When multiple events share the same timestamp, ordering is defined by append order in the stored run stream.
