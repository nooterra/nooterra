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

## Capability identifier policy

`capability` accepts two backward-safe forms:

- legacy non-URI strings (for existing deployments), for example `travel.booking`
- URI namespace form: `capability://<namespace>[@vN]`

URI form rules:

- scheme MUST be exactly `capability://`
- namespace MUST be lowercase
- namespace segments MUST be dot-separated and use `[a-z0-9-]` only
- empty segments are invalid
- segment and total-length policies are enforced deterministically
- optional version suffix MUST be `@vN` where `N` is a positive integer
- reserved top-level namespaces MUST fail closed

Validation failures MUST be fail-closed and expose stable `CAPABILITY_IDENTIFIER_*` reason codes in error messaging.

## Invariants

- `attestationHash` is deterministic over canonicalized content.
- validity windows must satisfy `issuedAt <= notBefore < expiresAt`.
- revocation is explicit and reflected in runtime evaluation.

## API surface

- `POST /capability-attestations`
- `GET /capability-attestations`
- `POST /capability-attestations/:attestationId/revoke`

## MCP surface

- `nooterra.capability_attest`
- `nooterra.capability_attestation_list`
- `nooterra.capability_attestation_revoke`

## Implementation references

- `src/core/capability-attestation.js`
- `src/api/app.js`
- `src/api/openapi.js`
