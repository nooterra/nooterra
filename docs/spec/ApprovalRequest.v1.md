# ApprovalRequest.v1

`ApprovalRequest.v1` defines the canonical approval prompt artifact for one authority envelope.

It binds a concrete approval request to the action fingerprint derived from `AuthorityEnvelope.v1`.

## Purpose

- freeze the approval request shown on hosted approval pages;
- bind the request back to the originating authority envelope and derived action hash;
- carry deterministic approval-policy hints that drive approval handling.

## Required fields

- `schemaVersion` (const: `ApprovalRequest.v1`)
- `requestId`
- `envelopeRef`
- `requestedBy`
- `requestedAt`
- `actionRef`
- `requestHash`

## Optional fields

- `approvalPolicy`

## Lifecycle

`ApprovalRequest.v1` stays a canonical prompt artifact and does not embed mutable lifecycle state.

Public Action Wallet alias routes expose top-level `approvalStatus` derived by [`ApprovalRequestLifecycle.v1.md`](./ApprovalRequestLifecycle.v1.md).

## Schema

See `schemas/ApprovalRequest.v1.schema.json`.
