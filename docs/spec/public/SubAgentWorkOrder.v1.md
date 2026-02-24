# SubAgentWorkOrder.v1

`SubAgentWorkOrder.v1` is the collaboration execution contract between a principal agent and a sub-agent.

Runtime status: implemented.

## Purpose

A work order tracks deterministic lifecycle state for delegated execution:

`created -> accepted -> working -> completed|failed -> settled`

## Required fields

- `schemaVersion` (const: `SubAgentWorkOrder.v1`)
- `workOrderId`
- `tenantId`
- `principalAgentId`
- `subAgentId`
- `requiredCapability`
- `specification`
- `pricing`
- `status`
- `createdAt`
- `updatedAt`
- `revision`

## Key optional fields

- `parentTaskId`
- `constraints`
- `delegationGrantRef`
- `progressEvents`
- `completionReceiptId`
- `settlement`
- `metadata`

## Settlement binding fields

When settled, binding includes:

- `settlement.status` (`released|refunded`)
- `settlement.x402GateId`
- `settlement.x402RunId`
- `settlement.x402SettlementStatus`
- `settlement.x402ReceiptId` (optional)
- `settlement.completionReceiptId`
- `settlement.settledAt`

## Invariants

- terminal work orders reject new progress events.
- settlement requires an existing completion receipt.
- revision increments with each state mutation.

## API surface

- `POST /work-orders`
- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders/:id/accept`
- `POST /work-orders/:id/progress`
- `POST /work-orders/:id/complete`
- `POST /work-orders/:id/settle`

## MCP surface

- `settld.work_order_create`
- `settld.work_order_accept`
- `settld.work_order_progress`
- `settld.work_order_complete`
- `settld.work_order_settle`

## Implementation references

- `src/core/subagent-work-order.js`
- `src/api/app.js`
- `src/api/openapi.js`
