# OperatorAction.v1

`OperatorAction.v1` is a canonical, hash-addressable audit artifact for high-risk human/operator decisions.

It captures a deterministic action surface (who acted, what was targeted, what decision was taken, and why), with optional signature material for offline verification.

## Purpose

`OperatorAction.v1` enables:

- deterministic replay/audit of operator decisions,
- cryptographic binding of an action to a specific target object/hash,
- strict vs non-strict verification behavior without ambiguous trust assumptions.

## Required fields

- `schemaVersion` (const: `OperatorAction.v1`)
- `actionId`
- `tenantId`
- `operatorId`
- `actionCode` (stable machine code, lowercase token)
- `decisionCode` (stable machine code, lowercase token)
- `reasonCode` (stable machine code, uppercase snake-case)
- `target`
  - `resourceType` (lowercase token)
  - `resourceId`
- `occurredAt` (ISO 8601 date-time)
- `createdAt` (ISO 8601 date-time)
- `actionHash`

Optional:

- `idempotencyKey`
- `reasonDetail`
- `target.resourceHash` (sha256 hex of referenced object when hash binding is required)
- `evidenceRefs` (deterministically ordered, unique references)
- `metadata`
- `signature`
  - `algorithm` (const: `ed25519`)
  - `signerKeyId`
  - `actionHash`
  - `signature` (base64)
  - `signedAt`

## Canonicalization + hashing

`actionHash` is computed over canonical JSON (RFC 8785 / JCS) of the full object excluding:

- `actionHash`
- `signature`

Hash algorithm: `sha256` over canonical UTF-8 bytes, lowercase hex output.

Optional fields MUST be omitted when absent (not `null`) unless a future schema version explicitly allows `null`.

## Signing

When present, `signature.signature` is an Ed25519 signature over the raw bytes of `actionHash` (hex-decoded 32-byte digest), encoded as base64.

Verifiers should validate in order:

1. `actionHash` recomputation matches object content,
2. `signature.actionHash === actionHash`,
3. signature verification succeeds for `signerKeyId`.

## Strict vs non-strict verification expectations

- **Strict**:
  - `signature` is required.
  - signer key must resolve to a trusted operator signing key.
  - missing/invalid signature, hash mismatch, or target hash mismatch (when `target.resourceHash` is present and the target is available) is a hard failure.
- **Non-strict**:
  - unsigned actions may be accepted for compatibility.
  - if `signature` is present, it must verify exactly as in strict mode.
  - tamper signals (`actionHash` mismatch, `signature.actionHash` mismatch, invalid signature) remain hard failures.

## Schema

See `docs/spec/schemas/OperatorAction.v1.schema.json`.
