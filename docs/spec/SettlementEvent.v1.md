# SettlementEvent.v1

`SettlementEvent.v1` defines the Action Wallet money-state transition projection for one finalized action.

In launch v1 it is derived from the stored `AgentRunSettlement.v1` row plus any linked `SettlementReceipt.v1` / hosted receipt detail. It names the settlement transition that matters for Action Wallet receipts and disputes without creating a new stored aggregate.

## Purpose

- freeze the launch vocabulary for money-state transitions attached to Action Wallet completion;
- bind the settlement transition back to the run, settlement, and receipt context;
- give receipts, disputes, and operator tooling one deterministic settlement-event projection.

## Projection semantics

- `eventType` names the settlement transition (`authorization`, `capture`, `refund`, `failure`, `dispute_hold`).
- `status` reflects the resulting settlement state after the transition.
- `receiptRef` binds the event to a receipt when one exists.
- `source` records whether the transition came from verification, operator action, or provider reconciliation.

This object is a v1 projection. The canonical stored source of truth remains `AgentRunSettlement.v1`.

## Required fields

- `schemaVersion` (const: `SettlementEvent.v1`)
- `settlementEventId`
- `eventType`
- `runId`
- `settlementId`
- `status`
- `recordedAt`

## Optional fields

- `disputeId`
- `amountCents`
- `currency`
- `resolutionEventId`
- `traceId`
- `source`
- `receiptRef`

## Schema

See `schemas/SettlementEvent.v1.schema.json`.
