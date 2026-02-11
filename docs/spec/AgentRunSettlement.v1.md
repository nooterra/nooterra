# AgentRunSettlement.v1

`AgentRunSettlement.v1` defines the escrow/settlement state for one `AgentRun.v1`.

Related contracts:
- `ESCROW_NETTING_INVARIANTS.md` (money conservation + partition rules)
- `MONEY_RAIL_STATE_MACHINE.md` (external payout/collection lifecycle)

It binds run execution outcomes to deterministic money movement:

- `locked`: escrow funded and awaiting run terminal outcome.
- `released`: run completed and escrow released to the run agent.
- `refunded`: run failed and escrow refunded to payer.

Related decision/finality artifacts:

- `SettlementDecisionRecord.v1|v2` and `SettlementReceipt.v1` bind decision provenance and finality receipts to one settlement.

## Schema

See `schemas/AgentRunSettlement.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `AgentRunSettlement.v1`)
- `settlementId`
- `runId`
- `tenantId`
- `agentId` (payee / run owner)
- `payerAgentId`
- `amountCents`
- `currency`
- `status` (`locked|released|refunded`)
- `lockedAt`
- `revision`
- `createdAt`
- `updatedAt`

## Resolution semantics

- Settlement is initialized as `locked`.
- Settlement may resolve exactly once to `released` or `refunded`.
- `resolvedAt` and `resolutionEventId` are populated on resolution.
- `runStatus` captures the terminal run state that triggered resolution.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
