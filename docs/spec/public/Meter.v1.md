# Meter.v1

`Meter.v1` is the canonical, hash-bound metering event object for usage-linked settlement flows.

Runtime status: implemented for work-order metering (`work_order_meter_topup`, `work_order_meter_usage`) and returned by `GET /work-orders/:workOrderId/metering`.

## Purpose

`Meter.v1` makes metering evidence portable and deterministic:

- one canonical object per metering event,
- stable `meterHash` computed over canonical JSON,
- source binding to a concrete work order.

## Required fields

- `schemaVersion` (const: `Meter.v1`)
- `meterId`
- `workOrderId`
- `meterType` (`topup|usage`)
- `sourceType` (`work_order_meter_topup|work_order_meter_usage`)
- `quantity`
- `amountCents`
- `occurredAt`
- `recordedAt`
- `meterHash`

## Optional fields

- `eventType`
- `sourceEventId`
- `currency`
- `period`
- `eventHash`
- `metadata`

## Hashing

- `meterHash = sha256(canonicalJson({ ...meter, meterHash: null }))`
- validation fails closed on any mismatch.

## API surface

- `GET /work-orders/:workOrderId/metering`

## MCP surface

- `nooterra.work_order_topup`
- `nooterra.work_order_metering_get`

## Implementation references

- `src/core/meter.js`
- `src/api/app.js`
- `scripts/mcp/nooterra-mcp-server.mjs`
