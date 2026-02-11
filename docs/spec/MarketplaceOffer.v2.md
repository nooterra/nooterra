# MarketplaceOffer.v2

`MarketplaceOffer.v2` is the canonical pre-contract offer artifact derived from a `MarketplaceBidProposal.v1` chain.

It freezes the selected proposal terms before agreement acceptance so downstream systems can bind acceptance, signatures, and settlement to one immutable offer hash.

## Purpose

- separate pre-contract offer state from agreement state;
- make accepted proposal terms portable and replayable;
- provide a stable `offerHash` anchor for `MarketplaceAcceptance.v2`.

## Required fields

- `schemaVersion` (const: `MarketplaceOffer.v2`)
- `offerId`
- `tenantId`
- `rfqId`
- `bidId`
- `revision`
- `amountCents`
- `currency`
- `proposalHash`
- `proposedAt`
- `createdAt`
- `offerHash`

Optional fields:

- `runId`
- `proposalId`
- `proposerAgentId`
- `etaSeconds`
- `note`
- `verificationMethod`
- `policy`
- `policyRef`
- `policyRefHash`
- `prevProposalHash`
- `offerChainHash`
- `proposalCount`
- `metadata`

## Canonicalization and hashing

`offerHash` is computed over canonical JSON after removing `offerHash`:

1. canonicalize JSON with RFC 8785 (JCS),
2. hash canonical UTF-8 bytes using `sha256`,
3. encode as lowercase hex.

## Schema

See `schemas/MarketplaceOffer.v2.schema.json`.
