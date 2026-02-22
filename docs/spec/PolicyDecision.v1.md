# PolicyDecision.v1

`PolicyDecision.v1` is the canonical, hash-addressable policy outcome artifact for settlement decisions.

It captures the exact policy/verification inputs used for decisioning, the normalized outcome, and an optional signer envelope.

## Purpose

`PolicyDecision.v1` provides a deterministic artifact that can be:

- bound into settlement decision/receipt traces,
- compared across reruns/replays,
- verified offline using canonical JSON + hash checks.

## Required fields

- `schemaVersion` (const: `PolicyDecision.v1`)
- `decisionId`
- `tenantId`
- `runId`
- `settlementId`
- `policyRef`
  - `policyId` (`string|null`)
  - `policyVersion` (`integer|null`)
  - `policyHash`
  - `verificationMethodHash`
- `decisionMode` (`automatic|manual-review`)
- `verificationStatus` (lowercase token)
- `runStatus` (lowercase token)
- `shouldAutoResolve` (boolean)
- `settlementStatus` (lowercase token)
- `releaseRatePct` (0..100)
- `releaseAmountCents` (integer >= 0)
- `refundAmountCents` (integer >= 0)
- `reasonCodes` (deterministically ordered unique list)
- `evaluationHash` (`sha256` hex of normalized evaluation input)
- `createdAt` (ISO 8601)
- `policyDecisionHash`

Optional:

- `gateId`
- `metadata`
- `signature`
  - `algorithm` (const: `ed25519`)
  - `signerKeyId`
  - `policyDecisionHash`
  - `signature` (base64)

## Canonicalization + hashing

`policyDecisionHash` is computed over canonical JSON (RFC 8785 / JCS) of the full object excluding:

- `policyDecisionHash`
- `signature`

Hash algorithm: `sha256` over canonical UTF-8 bytes, lowercase hex output.

## Evaluation hash

`evaluationHash` is derived from a stable evaluation input surface (`PolicyDecisionEvaluationInput.v1`) containing:

- policy + verification-method hashes,
- normalized verification/run/settlement statuses,
- normalized release/refund outcomes,
- normalized `reasonCodes`.

This allows lightweight policy-outcome equivalence checks without rehashing the full artifact.

## Signing

When present, `signature.signature` is an Ed25519 signature over `policyDecisionHash` bytes (hex decoded), base64-encoded.

Verifiers should first validate:

- `signature.policyDecisionHash === policyDecisionHash`,
- `policyDecisionHash` recomputation matches object content,

then verify Ed25519 signature using `signerKeyId` resolution.

## Schema

See `docs/spec/schemas/PolicyDecision.v1.schema.json`.
