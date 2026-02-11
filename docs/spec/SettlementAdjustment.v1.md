# SettlementAdjustment.v1

`SettlementAdjustment.v1` is a deterministic, idempotent adjustment artifact that applies a single escrow operation against funds held in a related `FundingHold.v1`.

Sprint 21 uses exactly one adjustment per `agreementHash` for tool-call holdback disputes.

## Fields

Required:

- `schemaVersion` (const: `SettlementAdjustment.v1`)
- `adjustmentId` (deterministic ID; for tool-call holdback: `sadj_agmt_${agreementHash}_holdback`)
- `tenantId`
- `agreementHash` (sha256 hex)
- `receiptHash` (sha256 hex)
- `holdHash` (sha256 hex)
- `kind` (`holdback_release|holdback_refund`)
- `amountCents` (non-negative int; must be `<= heldAmountCents` at application time)
- `currency`
- `createdAt` (ISO datetime)
- `adjustmentHash` (sha256 hex; computed from immutable core)

Optional:

- `verdictRef`:
  - `caseId`
  - `verdictHash` (sha256 hex)
- `metadata` (implementation-defined JSON object)

## Hashing

`adjustmentHash` is computed as sha256 of the RFC 8785 canonical JSON of the core object excluding:

- `adjustmentHash`
- `metadata`

## Invariants

- Adjustments must operate on held escrow funds only (no negative balances, no external clawbacks).
- Persistence must enforce uniqueness for `adjustmentId` per tenant; duplicates must be treated as idempotent retries returning the existing adjustment.

## Schema

See `docs/spec/schemas/SettlementAdjustment.v1.schema.json`.

