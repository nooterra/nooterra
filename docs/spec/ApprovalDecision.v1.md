# ApprovalDecision.v1

`ApprovalDecision.v1` defines the canonical decision artifact for one approval request.

It captures the single approve-or-deny decision bound to the request, envelope hash, and action hash.

## Purpose

- freeze the user or operator approval outcome;
- bind the decision back to the approval request and requested action;
- provide a deterministic approval artifact for grant issuance and receipts.

## Required fields

- `schemaVersion` (const: `ApprovalDecision.v1`)
- `decisionId`
- `requestId`
- `envelopeHash`
- `actionId`
- `actionSha256`
- `decidedBy`
- `decidedAt`
- `approved`
- `evidenceRefs`
- `decisionHash`

## Optional fields

- `expiresAt`
- `binding`
- `metadata`

## Schema

See `schemas/ApprovalDecision.v1.schema.json`.
