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

## Append, list, and stream invariants

- append is fail-closed without `x-proxy-expected-prev-chain-hash`.
- append is optimistic-concurrency checked against current stream head.
- append is idempotent when idempotency keys are reused with identical request hash.
- idempotency replay must survive multi-writer retries; stale head retries with matching idempotency key return the original response.
- append conflicts fail closed with deterministic details: `reasonCode=SESSION_EVENT_APPEND_CONFLICT`, `phase`, `expectedPrevChainHash`, `gotExpectedPrevChainHash`/`gotPrevChainHash`, and stream range metadata (`eventCount`, `firstEventId`, `lastEventId`).
- inbox ordering is deterministic (`SESSION_SEQ_ASC`) across list and stream surfaces.
- inbox resume watermarks are explicit for offline clients (`headEventCount`, `headFirstEventId`, `headLastEventId`, `sinceEventId`, `nextSinceEventId`).
- stream `session.ready` watermark `nextSinceEventId` tracks current stream head (`headLastEventId`) for reconnect-safe resume cursor progression.
- list cursor (`sinceEventId`) must resolve to an existing event id, else fail closed.
- stream cursor (`sinceEventId` or `Last-Event-ID`) must resolve to an existing event id, else fail closed.
- stream cursor source must be unambiguous: when both `sinceEventId` and `Last-Event-ID` are provided, they must match.
- stream emits deterministic `session.watermark` frames when head advances so filtered/offline consumers can progress resume cursors without relying on matched `session.event` payloads.
- repeated reconnect/retry loops must keep resume cursor progression monotonic (`sinceEventId`/`nextSinceEventId`) and avoid duplicate terminal deliveries for identical timeline history.
- cursor failures expose deterministic gap metadata in `details`: `reasonCode=SESSION_EVENT_CURSOR_NOT_FOUND`, `eventCount`, `firstEventId`, `lastEventId`, and `phase`.

## Inbox watermark headers

- `x-session-events-ordering`
- `x-session-events-delivery-mode`
- `x-session-events-head-event-count`
- `x-session-events-head-first-event-id`
- `x-session-events-head-last-event-id`
- `x-session-events-since-event-id`
- `x-session-events-next-since-event-id`

`GET /sessions/:sessionId/events/stream` includes the same watermark fields in the `session.ready` payload under `inbox` and emits `session.watermark` updates (`phase`, `lastDeliveredEventId`, `inbox`) as head advances during long-poll churn.

## API surface

- `GET /sessions/:sessionId/events`
- `POST /sessions/:sessionId/events`
- `GET /sessions/:sessionId/events/stream`

## MCP surface

- `nooterra.session_events_list`
- `nooterra.session_event_append`
- `nooterra.session_events_stream`

## Implementation references

- `src/core/session-collab.js`
- `src/api/app.js`
- `src/api/openapi.js`
