# SessionEventProvenance.v1

`SessionEventProvenance.v1` is the deterministic taint/provenance envelope attached to `SessionEvent.v1` payloads.

Runtime status: implemented.

## Purpose

Encode contamination lineage for prompt/input risk decisions so downstream policy enforcement can fail closed on tainted derivations.

## Required fields

- `schemaVersion` (const: `SessionEventProvenance.v1`)
- `label` (`trusted|external|tainted`)
- `derivedFromEventId` (nullable)
- `isTainted` (boolean)
- `taintDepth` (non-negative integer)
- `explicitTaint` (boolean)
- `reasonCodes` (sorted unique set)

## Reason-code vocabulary (v1)

- `session_provenance_external_input`
- `session_provenance_declared_tainted`
- `session_provenance_inherited_taint`
- `session_provenance_explicit_taint`

## Deterministic computation rules

- default label is event-type aware (`MESSAGE` defaults external; all others default trusted).
- `derivedFromEventId` must reference an existing prior event when provided.
- taint propagates transitively: tainted parent implies tainted child.
- `taintDepth` increments on inherited taint chains.
- `reasonCodes` are normalized, de-duplicated, and lexicographically sorted.

## Verification

Replay/export verification must canonicalize and recompute provenance for each event against prior timeline state.
Any mismatch is fail-closed and blocks replay-pack issuance.

## Implementation references

- `src/core/session-collab.js`
- `src/api/app.js`

