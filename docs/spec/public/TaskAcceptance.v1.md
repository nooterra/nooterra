# TaskAcceptance.v1

`TaskAcceptance.v1` is the final negotiation binding object that links quote and offer hashes before settlement-bound execution.

Runtime status: implemented.

## Purpose

Acceptance is the deterministic handshake artifact:

`accepted` (terminal in v1)

## Required fields

- `schemaVersion` (const: `TaskAcceptance.v1`)
- `acceptanceId`
- `tenantId`
- `buyerAgentId`
- `sellerAgentId`
- `quoteRef.quoteId`
- `quoteRef.quoteHash`
- `offerRef.offerId`
- `offerRef.offerHash`
- `acceptedByAgentId`
- `status` (const: `accepted`)
- `acceptedAt`
- `acceptanceHash`

## Key optional fields

- `metadata`

## Invariants

- `acceptanceHash` is canonical `sha256` over acceptance content with `acceptanceHash: null`.
- `status` must be `accepted` in v1.
- quote and offer refs are required and hash-addressed.

## Settlement binding

When a work order is created with `acceptanceRef`, settlement is fail-closed unless:

- the bound acceptance exists and validates,
- the bound `acceptanceHash` matches request and stored binding.

## API surface

- `POST /task-acceptances`
- `GET /task-acceptances`
- `GET /task-acceptances/:acceptanceId`

## MCP surface

- `settld.task_acceptance_issue`
- `settld.task_acceptance_list`

## Implementation references

- `src/core/task-negotiation.js`
- `src/api/app.js`
- `src/api/openapi.js`
