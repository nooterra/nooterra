# TaskQuote.v1

`TaskQuote.v1` is the seller/buyer negotiation quote object used before a `SubAgentWorkOrder.v1` is finalized.

Runtime status: implemented.

## Purpose

A quote advertises executable terms for a task request and is hash-bindable for acceptance:

`open -> accepted|expired|revoked`

## Required fields

- `schemaVersion` (const: `TaskQuote.v1`)
- `quoteId`
- `tenantId`
- `buyerAgentId`
- `sellerAgentId`
- `requiredCapability`
- `pricing`
- `status`
- `createdAt`
- `updatedAt`
- `quoteHash`

## Key optional fields

- `traceId` (shared trace for quote -> offer -> acceptance -> work-order lineage)
- `constraints`
- `attestationRequirement`
- `expiresAt`
- `metadata`

## Invariants

- `quoteHash` is canonical `sha256` over quote content with `quoteHash: null`.
- `status` is one of `open|accepted|expired|revoked`.
- `pricing.model` is currently `fixed`.
- when present, `traceId` must be propagated or explicitly matched by downstream offer/acceptance objects.

## API surface

- `POST /task-quotes`
- `GET /task-quotes`
- `GET /task-quotes/:quoteId`

## MCP surface

- `nooterra.task_quote_issue`
- `nooterra.task_quote_list`

## Implementation references

- `src/core/task-negotiation.js`
- `src/api/app.js`
- `src/api/openapi.js`
