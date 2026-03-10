# ActionReceipt.v1

`ActionReceipt.v1` defines the public Action Wallet receipt alias returned by `/v1/receipts/{receiptId}`.

It is a projection over `SubAgentCompletionReceipt.v1` plus hosted receipt detail, integrity checks, and settlement context.

## Purpose

- present a host-run action outcome in user-facing receipt language;
- bind execution evidence and attestation to the completion receipt hash;
- expose settlement state and receipt-integrity issues in one hosted receipt view;
- bind the frozen receipt semantics for originating approval, execution grant, evidence bundle, verifier verdict, and dispute state.

## Alias semantics

- `receiptId` and `receiptHash` come from the canonical `SubAgentCompletionReceipt.v1`; `receiptHash` is the stable semantic hash for the launch receipt.
- `originatingApproval` binds the receipt back to the approval request and approval decision that authorized the run.
- `executionGrantRef` binds the receipt to the launch execution-grant alias that the host consumed, including the deterministic `grantHash`.
- `evidenceBundle` is the deterministic projection of receipt evidence refs plus execution-attestation linkage, including the deterministic `evidenceBundleHash`.
- `settlementState` prefers the linked `AgentRunSettlement.v1` row when the receipt has an `x402RunId`, and otherwise falls back to the work-order settlement binding.
- `verifierVerdict` prefers settlement decision-trace verification metadata when available and otherwise falls back to hosted receipt-integrity checks.
- `disputeState` prefers linked dispute context from `AgentRunSettlement.v1` plus arbitration detail when present and otherwise resolves to `none`.
- `settlement` and `integrityStatus` come from hosted receipt detail assembled at read time.
- `issues` is the deterministic set of receipt-integrity issues found by the hosted receipt builder.

This object is intentionally an alias in v1. It does not create a separate stored aggregate.

## Required fields

- `schemaVersion` (const: `ActionReceipt.v1`)
- `receiptId`
- `workOrderId`
- `status`
- `receiptHash`

## Optional fields

- `deliveredAt`
- `traceId`
- `originatingApproval`
- `executionGrantRef`
- `evidenceBundle`
- `evidenceRefs`
- `executionAttestation`
- `settlementState`
- `verifierVerdict`
- `disputeState`
- `settlement`
- `integrityStatus`
- `issues`

## Schema

See `schemas/ActionReceipt.v1.schema.json`.
