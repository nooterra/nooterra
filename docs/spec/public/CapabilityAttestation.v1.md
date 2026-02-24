# CapabilityAttestation.v1

`CapabilityAttestation.v1` is a signed capability claim for an agent.

Runtime status: implemented.

## Purpose

Attestations provide queryable trust signals for discovery and delegation decisions.

They bind:

- subject agent,
- capability string,
- attestation level,
- issuer and signature,
- validity window,
- revocation status.

## Required fields

- `schemaVersion` (const: `CapabilityAttestation.v1`)
- `attestationId`
- `tenantId`
- `subjectAgentId`
- `capability`
- `level`
- `validity`
- `signature`
- `revocation`
- `createdAt`
- `updatedAt`
- `revision`
- `attestationHash`

## Levels

- `self_claim`
- `attested`
- `certified`

## Runtime validity statuses

- `valid`
- `expired`
- `not_active`
- `revoked`

## Invariants

- `attestationHash` is deterministic over canonicalized content.
- validity windows must satisfy `issuedAt <= notBefore < expiresAt`.
- revocation is explicit and reflected in runtime evaluation.
- discovery is fail-closed: capability attestations with unverifiable signatures are treated as invalid candidates.

## Signature semantics (Ed25519)

`CapabilityAttestation.v1` signatures are required to be cryptographically meaningful:

- `signature.algorithm` MUST be `ed25519`
- `signature.keyId` MUST match the issuer agent identity’s registered key id: `AgentIdentity.v1.keys.keyId`
- `signature.signature` MUST be a base64 Ed25519 signature over the signature-payload hash below

### Signature payload hash

The signed message is the 32-byte SHA-256 of the canonical JSON payload:

- `schemaVersion`: `CapabilityAttestationSignaturePayload.v1`
- `attestationId`, `tenantId`, `subjectAgentId`, `capability`, `level`, `issuerAgentId`
- `validity`
- `signature.algorithm`, `signature.keyId` (but NOT `signature.signature`)
- `verificationMethod`
- `evidenceRefs`
- `metadata`

Explicitly excluded from the signature payload:

- server/derived bookkeeping: `attestationHash`, `createdAt`, `updatedAt`, `revision`
- mutable state: `revocation` (revocation can be applied after issuance without re-signing)

## API surface

- `POST /capability-attestations`
- `GET /capability-attestations`
- `POST /capability-attestations/:attestationId/revoke`

## MCP surface

- `settld.capability_attest`
- `settld.capability_attestation_list`
- `settld.capability_attestation_revoke`

## Implementation references

- `src/core/capability-attestation.js`
- `src/api/app.js`
- `src/api/openapi.js`
