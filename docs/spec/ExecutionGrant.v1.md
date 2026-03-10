# ExecutionGrant.v1

`ExecutionGrant.v1` defines the public Action Wallet execution-grant alias returned by `/v1/execution-grants/{executionGrantId}`.

It is a projection over approval state, approval continuation state, and the materialized `SubAgentWorkOrder.v1` that the external host executes in v1.

## Purpose

- expose the current host-facing execution handle after approval;
- bind the grant back to the approving request and decision;
- show whether the grant is still pending approval, approved, denied, or materialized to a work order;
- surface the frozen launch semantics for principal, action type, bounded scope, spend cap, expiry, nonce, and lineage.

## Alias semantics

- `executionGrantId` resolves from the explicit path id, materialized `workOrderId`, or the approval `requestId`.
- `principal` resolves from `authorityEnvelope.principalRef`.
- `hostId` resolves from the trusted host actor (`authorityEnvelope.actor.agentId`) and falls back to the canonical approval requester only when needed.
- `actionType` and `vendorOrDomainAllowlist` project from `authorityEnvelope.metadata.actionWallet.*` when the host supplied launch-scope metadata explicitly.
- `spendCap` mirrors the bounded `authorityEnvelope.spendEnvelope`.
- `expiresAt` resolves to the earliest explicit execution deadline from the authority envelope duration or approval decision expiry.
- `grantHash` is the stable semantic hash for the issued execution grant and appears only once the grant is actually approved or materialized.
- `grantNonce` is deterministic and appears only after an approval decision has issued an executable grant.
- `delegationLineageRef` is a placeholder compatibility object over the envelope root plus any approval binding grant refs.
- `authorityEnvelopeRef`, `approvalRequestRef`, and `approvalDecisionRef` bind the grant back to the approval chain.
- `continuation` carries the current resume/result linkage when the host polls or resumes after approval.
- `workOrderId` is present only once the host-run action has been materialized for execution.

This object is intentionally an alias in v1. It does not create a separate stored aggregate.

## Required fields

- `schemaVersion` (const: `ExecutionGrant.v1`)
- `executionGrantId`
- `status`

## Optional fields

- `createdAt`
- `principal`
- `actionType`
- `hostId`
- `vendorOrDomainAllowlist`
- `spendCap`
- `expiresAt`
- `grantHash`
- `grantNonce`
- `delegationLineageRef`
- `workOrderId`
- `requiredCapability`
- `spendEnvelope`
- `evidenceRequirements`
- `authorityEnvelopeRef`
- `approvalRequestRef`
- `approvalDecisionRef`
- `continuation`

## Schema

See `schemas/ExecutionGrant.v1.schema.json`.
