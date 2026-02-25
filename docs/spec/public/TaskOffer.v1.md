# TaskOffer.v1

`TaskOffer.v1` is the counterparty negotiation offer object used to bind quote terms into a deterministic acceptance.

Runtime status: implemented.

## Purpose

An offer carries executable pricing/constraints and can optionally bind to a quote by hash:

`open -> accepted|expired|revoked`

## Required fields

- `schemaVersion` (const: `TaskOffer.v1`)
- `offerId`
- `tenantId`
- `buyerAgentId`
- `sellerAgentId`
- `pricing`
- `status`
- `createdAt`
- `updatedAt`
- `offerHash`

## Key optional fields

- `quoteRef.quoteId`
- `quoteRef.quoteHash`
- `constraints`
- `expiresAt`
- `metadata`

## Invariants

- `offerHash` is canonical `sha256` over offer content with `offerHash: null`.
- if `quoteRef.quoteHash` is present, it must be 64-char lowercase hex.
- `status` is one of `open|accepted|expired|revoked`.

## API surface

- `POST /task-offers`
- `GET /task-offers`
- `GET /task-offers/:offerId`

## MCP surface

- `settld.task_offer_issue`
- `settld.task_offer_list`

## Implementation references

- `src/core/task-negotiation.js`
- `src/api/app.js`
- `src/api/openapi.js`
