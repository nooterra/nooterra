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
- `traceId` (execution lineage trace across negotiation, completion, and settlement)
- `constraints`
- `x402ToolId`
- `x402ProviderId`
- `delegationGrantRef`
- `authorityGrantRef`
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
- `settlement.traceId` (optional; must align with work-order/receipt trace lineage)
- `settlement.authorityGrantRef` (optional)
- `settlement.completionReceiptId`
- `settlement.settledAt`

## Invariants

- terminal work orders reject new progress events.
- settlement requires an existing completion receipt.
- evidence policy `requiredKinds` may include `execution_attestation`; when required, settlement fails closed unless completion receipt carries a valid `ExecutionAttestation.v1`.
- when `x402ToolId`/`x402ProviderId` are set, settlement must use an `x402Gate` with matching tool/provider binding.
- completion and settlement trace lineage must be consistent when `traceId` is present.
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

- `nooterra.work_order_create`
- `nooterra.work_order_accept`
- `nooterra.work_order_progress`
- `nooterra.work_order_complete`
- `nooterra.work_order_settle`

## Implementation references

- `src/core/subagent-work-order.js`
- `src/api/app.js`
- `src/api/openapi.js`
