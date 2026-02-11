# MarketplaceAcceptance.v2

`MarketplaceAcceptance.v2` is the canonical acceptance artifact for one selected `MarketplaceOffer.v2`.

It binds acceptance metadata (`acceptedBy`, proposal identity, chain hash, counts) to a stable `offerRef` (`offerId`, `offerHash`) and emits `acceptanceHash`.

## Purpose

- make acceptance independently replayable from the agreement envelope;
- explicitly bind acceptance to a hashed offer artifact;
- provide a stable acceptance hash for signatures/audit and downstream dispute traces.

## Required fields

- `schemaVersion` (const: `MarketplaceAcceptance.v2`)
- `acceptanceId`
- `tenantId`
- `rfqId`
- `runId`
- `bidId`
- `acceptedAt`
- `acceptedByAgentId`
- `acceptedProposalId`
- `acceptedRevision`
- `acceptedProposalHash`
- `offerChainHash`
- `proposalCount`
- `offerRef` (`offerId`, `offerHash`)
- `createdAt`
- `acceptanceHash`

Optional fields:

- `agreementId`

## Canonicalization and hashing

`acceptanceHash` is computed over canonical JSON after removing `acceptanceHash`:

1. canonicalize JSON with RFC 8785 (JCS),
2. hash canonical UTF-8 bytes using `sha256`,
3. encode as lowercase hex.

## Schema

See `schemas/MarketplaceAcceptance.v2.schema.json`.
