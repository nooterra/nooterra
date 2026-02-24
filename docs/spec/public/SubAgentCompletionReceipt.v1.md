# SubAgentCompletionReceipt.v1

`SubAgentCompletionReceipt.v1` is the immutable completion proof attached to a work order.

Runtime status: implemented.

## Purpose

This receipt proves completion output, metrics, and evidence for a delegated task, and provides deterministic hash binding for audit and settlement.

## Required fields

- `schemaVersion` (const: `SubAgentCompletionReceipt.v1`)
- `receiptId`
- `tenantId`
- `workOrderId`
- `status` (`success|failed`)
- `deliveredAt`
- `receiptHash`
- `createdAt`
- `updatedAt`
- `revision`

## Common fields

- `outputs` (object, optional)
- `metrics` (object, optional)
- `evidenceRefs` (array, optional)
- `amountCents` (optional)
- `currency` (optional)
- `metadata` (optional)

## Invariants

- `receiptHash` is deterministic over canonicalized receipt material.
- work order completion must reference exactly one completion receipt.
- receipts are append-only by identity; duplicate `receiptId` is rejected.

## API surface

- created via `POST /work-orders/:id/complete`
- listed via `GET /work-orders/receipts`
- fetched via `GET /work-orders/receipts/:receiptId`

## MCP surface

- produced by `settld.work_order_complete`

## Implementation references

- `src/core/subagent-work-order.js`
- `src/api/app.js`
- `src/api/openapi.js`
