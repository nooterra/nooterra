# SessionPromptRiskSignals.v1

`SessionPromptRiskSignals.v1` is the deterministic risk-signal object derived from session provenance for high-risk decision gates.

Runtime status: implemented.

## Purpose

Expose auditable taint ancestry and forced policy mode (`challenge|escalate`) so payment/side-effect paths can fail closed consistently.

## Required fields

- `schemaVersion` (const: `SessionPromptRiskSignals.v1`)
- `suspicious` (boolean)
- `promptContagion` (boolean)
- `forcedMode` (`challenge|escalate|null`)
- `reasonCodes` (sorted unique set)
- `evidenceRefs` (sorted unique set)
- `source` (nullable `{ sessionId, eventId }`)

## Deterministic derivation rules

- no tainted events -> `suspicious=false`, `promptContagion=false`, `forcedMode=null`, empty evidence/reason sets.
- tainted ancestry present -> `suspicious=true`, `promptContagion=true`.
- `forcedMode` is threshold-based:
  - `escalate` when amount >= configured escalation threshold
  - `challenge` otherwise
- `evidenceRefs` include canonical session event/chain refs for the latest tainted event.

## Integration points

- `resolveSessionPromptRiskSignalsForX402` derives this object before x402 payment authorization/quote flows.
- forced mode is mapped into fail-closed prompt-risk policy controls.

## Implementation references

- `src/core/session-collab.js`
- `src/api/app.js`
