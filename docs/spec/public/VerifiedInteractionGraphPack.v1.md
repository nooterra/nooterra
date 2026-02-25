# VerifiedInteractionGraphPack.v1

`VerifiedInteractionGraphPack.v1` is a deterministic, hash-bound export of an agent's relationship graph snapshot and aggregate trust summary at a fixed time window.

Runtime status: implemented.

## Purpose

Provide a portable interaction graph artifact that can be audited, cached, and re-verified without exposing raw event streams.

## Required fields

- `schemaVersion` (const: `VerifiedInteractionGraphPack.v1`)
- `tenantId`
- `agentId`
- `reputationVersion` (`v1|v2`)
- `reputationWindow` (`7d|30d|allTime`)
- `asOf`
- `generatedAt`
- `relationshipCount`
- `relationshipsHash`
- `summaryHash`
- `verification` (`InteractionGraphVerification.v1`)
- `summary` (`InteractionGraphSummary.v1`)
- `relationships` (array of `RelationshipEdge.v1`)
- `packHash`

Optional:

- `signature` (`VerifiedInteractionGraphPackSignature.v1`)

## Hashing model

- `relationshipsHash` = `sha256(canonical-json(relationships))`
- `summaryHash` = `sha256(canonical-json(summary))`
- `packHash` = `sha256(canonical-json(pack-without-packHash))`

All hashes are deterministic for a fixed `(tenantId, agentId, reputationWindow, asOf, filter set)`.

## Optional signature

When requested, the pack can include:

- `signature.schemaVersion` = `VerifiedInteractionGraphPackSignature.v1`
- `signature.algorithm` = `ed25519`
- `signature.keyId`
- `signature.signedAt`
- `signature.payloadHash` (must equal `packHash`)
- `signature.signatureBase64`

Signature verification target is the deterministic `packHash`.

## InteractionGraphSummary.v1

Required summary fields:

- `schemaVersion` (const: `InteractionGraphSummary.v1`)
- `agentId`
- `reputationVersion`
- `reputationWindow`
- `asOf`
- `trustScore`
- `riskTier`
- `eventCount`
- `decisionsTotal`
- `decisionsApproved`
- `successRate`
- `disputesOpened`
- `disputeRate`
- `settledCents`
- `refundedCents`
- `penalizedCents`
- `autoReleasedCents`
- `adjustmentAppliedCents`
- `relationshipCount`
- `economicallyQualifiedRelationshipCount`
- `dampenedRelationshipCount`
- `collusionSuspectedRelationshipCount`
- `lastInteractionAt`

## InteractionGraphVerification.v1

- `schemaVersion` (const: `InteractionGraphVerification.v1`)
- `deterministicOrdering` (bool)
- `antiGamingSignalsPresent` (bool)
- `generatedBy`

## API surface

- tenant-scoped export: `GET /agents/:agentId/interaction-graph-pack`

Supported query filters:

- `reputationVersion`
- `reputationWindow`
- `asOf`
- `counterpartyAgentId`
- `visibility`
- `sign` (bool; optional)
- `signerKeyId` (optional; requires `sign=true`)
- `limit`
- `offset`

## Implementation references

- `src/core/interaction-graph-pack.js`
- `src/api/app.js`
- `src/api/openapi.js`
