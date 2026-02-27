# ReputationEvent.v1

`ReputationEvent.v1` is the append-only fact object used to derive trust, routing, and relationship aggregates.

Runtime status: implemented.

## Purpose

Capture deterministic outcome facts (decision, dispute, verdict, adjustments) with canonical hash binding and provenance refs.

## Required fields

- `schemaVersion` (const: `ReputationEvent.v1`)
- `artifactType` (const: `ReputationEvent.v1`)
- `eventId`
- `eventKind`
- `tenantId`
- `occurredAt`
- `subject` (includes `agentId`; optional `counterpartyAgentId`; role and tool context)
- `sourceRef` (settlement/dispute/run linkage)
- `facts` (event-specific metrics/economic facts)
- `eventHash`

## Allowed event kinds

- `decision_approved`
- `decision_rejected`
- `dispute_opened`
- `verdict_issued`
- `holdback_auto_released`
- `adjustment_applied`

## Invariants

- `eventHash` must match deterministic canonical hash of event material.
- `eventKind` drives required `sourceRef`/`facts` fields; invalid combinations fail closed.
- events are immutable; retries are idempotent by `eventId`.

## API surface

- queried via `GET /ops/reputation/facts`
- consumed by trust-weighted discovery and relationship aggregation

## Implementation references

- `src/core/reputation-event.js`
- `src/core/agent-reputation.js`
- `src/api/app.js`
- `src/api/openapi.js`
