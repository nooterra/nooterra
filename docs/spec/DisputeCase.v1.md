# DisputeCase.v1

`DisputeCase.v1` defines the public Action Wallet dispute alias returned by `/v1/disputes`.

It is a projection over the stored `ArbitrationCase.v1`, the linked `AgentRunSettlement.v1` dispute context, and the hosted dispute-detail view.

## Purpose

- expose the dispute handle that a user or host can track from a receipt;
- bind public dispute status back to the stored arbitration and settlement records;
- preserve one stable hosted shape while the internal dispute and arbitration model stays richer than the public alias.

## Alias semantics

- `disputeId` comes from dispute context on the linked settlement when available.
- `caseId` is the canonical `ArbitrationCase.v1` id when arbitration has been opened.
- `status` is the launch lifecycle projection over settlement dispute context plus arbitration state:
  - `opened`: dispute has been opened but has not yet been triaged into arbitration.
  - `awaiting_evidence`: dispute has an arbitration case but evidence is still missing from the hosted detail packet.
  - `triaged`: dispute has an arbitration case with evidence attached and remains under review.
  - `refunded`: dispute is closed and the settlement resolved to `refunded`.
  - `denied`: dispute is closed and the settlement closed with a rejecting outcome.
  - `resolved`: dispute is closed without a refund-only or denied terminal mapping.
- `settlementStatus` is derived from the linked settlement snapshot.
- `detail` is the hosted dispute detail payload returned by the Action Wallet API.

This object is intentionally an alias in v1. It does not create a separate stored aggregate.

## Required fields

- `schemaVersion` (const: `DisputeCase.v1`)

## Optional fields

- `disputeId`
- `caseId`
- `status`
- `openedAt`
- `settlementStatus`
- `detail`

## Schema

See `schemas/DisputeCase.v1.schema.json`.
