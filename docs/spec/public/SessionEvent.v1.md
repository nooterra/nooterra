# SessionEvent.v1

`SessionEvent.v1` is the append-only, hash-chained timeline event format used by collaboration sessions.

Runtime status: implemented.

## Purpose

`SessionEvent.v1` captures message, negotiation, settlement, and risk/governance signals in a deterministic stream that supports replay and verification.

## Required payload fields

- `schemaVersion` (const: `SessionEvent.v1`)
- `sessionId`
- `eventType`
- `at` (ISO datetime)

## Key optional payload fields

- `payload` (canonical JSON object/null)
- `traceId`
- `provenance` (`SessionEventProvenance.v1`)

## Supported `eventType` values

- `MESSAGE`
- `TASK_REQUESTED`
- `QUOTE_ISSUED`
- `TASK_ACCEPTED`
- `TASK_PROGRESS`
- `TASK_COMPLETED`
- `SETTLEMENT_LOCKED`
- `SETTLEMENT_RELEASED`
- `SETTLEMENT_REFUNDED`
- `POLICY_CHALLENGED`
- `DISPUTE_OPENED`

## Provenance and prompt-contagion controls

`provenance.label` is normalized to `trusted|external|tainted`.

Server-side append computes provenance with chain-aware taint propagation and deterministic reason codes, including:

- `session_provenance_external_input`
- `session_provenance_declared_tainted`
- `session_provenance_inherited_taint`
- `session_provenance_explicit_taint`

## Append and stream invariants

- append is fail-closed without `x-proxy-expected-prev-chain-hash`.
- append is optimistic-concurrency checked against current stream head.
- append is idempotent when idempotency keys are reused with identical request hash.
- stream cursor (`sinceEventId` or `Last-Event-ID`) must resolve to an existing event id, else fail closed.

## API surface

- `GET /sessions/:sessionId/events`
- `POST /sessions/:sessionId/events`
- `GET /sessions/:sessionId/events/stream`

## MCP surface

- `settld.session_events_list`
- `settld.session_event_append`
- `settld.session_events_stream`

## Implementation references

- `src/core/session-collab.js`
- `src/api/app.js`
- `src/api/openapi.js`

