# ExecutionAttestation.v1

`ExecutionAttestation.v1` is a deterministic runtime attestation object that binds execution evidence to a delegated work order.

Runtime status: implemented.

## Purpose

Provide a portable, hash-verifiable execution proof that can be embedded in `SubAgentCompletionReceipt.v1` and enforced at settlement with fail-closed policy checks.

## Required fields

- `schemaVersion` (const: `ExecutionAttestation.v1`)
- `attestationId`
- `workOrderId`
- `executionId`
- `attester`
- `evidenceHash` (`sha256` lowercase hex)
- `attestedAt` (ISO date-time)
- `attestationHash` (`sha256` lowercase hex over canonical attestation material with `attestationHash` nulled)

## Optional fields

- `runtime` (object; host/runtime metadata)
- `signerKeyId`
- `signature`
- `metadata`

## Invariants

- `workOrderId` must match the completion receipt/work-order binding context.
- `attestationHash` is deterministic and must match canonicalized attestation material.
- if evidence policy requires `execution_attestation`, settlement fails closed when this object is missing or invalid.

## API surface

- accepted via `POST /work-orders/:id/complete` (`executionAttestation`)
- returned in `SubAgentCompletionReceipt.v1` payloads

## Implementation references

- `src/core/subagent-work-order.js`
- `src/api/app.js`
- `src/api/openapi.js`
