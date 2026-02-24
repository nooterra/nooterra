# CapabilityTrial.v1

`CapabilityTrial.v1` describes a deterministic evaluation that can be run to produce verifiable, machine-readable evidence for a capability claim.

Status: implemented (v1 runner).

## Purpose

Capability trials exist to make “capable” mean something operationally:

- they define a fixed set of checks (with stable ids),
- they emit a deterministic report contract,
- and they can be referenced from `CapabilityAttestation.v1` via `verificationMethod` + `evidenceRefs`.

## Required fields

- `schemaVersion` (const: `CapabilityTrial.v1`)
- `trialId` (stable id; versioned, e.g. `work_order_worker_protocol.v1`)
- `displayName`
- `capability` (the capability string this trial evaluates)
- `description` (short: what this trial proves)

## Invariants

- `trialId` is immutable once published (changes require a new versioned id).
- check ids inside a trial are stable (used for audit + regression tracking).

## Reference implementation

- `scripts/trials/run-capability-trial.mjs`

