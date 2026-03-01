# IntentContract.v1

`IntentContract.v1` is the deterministic intent handshake contract between proposer and responder before execution/settlement is allowed.

Runtime status: implemented.

## Purpose

The contract binds a negotiation session to a canonical intent envelope and hash-addressable integrity check.

It is designed to fail closed when hash evidence is missing, malformed, or tampered.

## Required fields

- `schemaVersion` (const: `IntentContract.v1`)
- `intentId`
- `negotiationId`
- `tenantId`
- `proposerAgentId`
- `responderAgentId`
- `intent`
- `idempotencyKey`
- `nonce`
- `expiresAt`
- `createdAt`
- `updatedAt`
- `intentHash`

## Intent envelope (required)

`intent` includes:

- `taskType`
- `capabilityId`
- `riskClass` (`read|compute|action|financial`)
- `expectedDeterminism` (`deterministic|bounded_nondeterministic|open_nondeterministic`)
- `sideEffecting`
- `maxLossCents`
- `spendLimit.currency`
- `spendLimit.maxAmountCents`
- `parametersHash` (nullable sha256)
- `constraints` (nullable canonical JSON)

## Invariants

- `intentHash` is canonical `sha256` over the contract with `intentHash: null`.
- unknown fields are rejected to prevent contract drift.
- hash mismatch is fail-closed (`INTENT_CONTRACT_HASH_TAMPERED`).
- missing/invalid hash is fail-closed (`INTENT_CONTRACT_HASH_REQUIRED|INTENT_CONTRACT_HASH_INVALID`).

## Negotiation event binding

`IntentNegotiationEvent.v1` (`propose|counter|accept`) binds back to:

- `intentId`
- `negotiationId`
- `intentHash`

Event validation is fail-closed if bound intent hash is missing/invalid/tampered/mismatched.

## Schemas

- `docs/spec/schemas/IntentContract.v1.schema.json`
- `docs/spec/schemas/IntentNegotiationEvent.v1.schema.json`

## Implementation references

- `src/core/intent-contract.js`
- `src/core/intent-negotiation.js`
- `scripts/intent/contract-helpers.mjs`
