# FundingHold.v1

`FundingHold.v1` represents a deterministic, wallet-backed escrow hold created for a specific settlement subject (for Sprint 21: tool-call holdback).

It is designed to support:

- A bounded challenge window (`challengeWindowMs`) after hold creation.
- Automatic release of held funds if no dispute is opened before the window ends.
- Freeze of auto-release while a related arbitration case remains open.
- Resolution via an idempotent, deterministic `SettlementAdjustment.v1` keyed by `agreementHash`.

## Fields

Required:

- `schemaVersion` (const: `FundingHold.v1`)
- `tenantId`
- `agreementHash` (sha256 hex, lowercase)
- `receiptHash` (sha256 hex, lowercase)
- `payerAgentId`
- `payeeAgentId`
- `amountCents` (gross amount for the subject)
- `heldAmountCents` (portion held in escrow; must be `<= amountCents`)
- `currency`
- `holdbackBps` (basis points, 0..)
- `challengeWindowMs` (0..)
- `createdAt` (ISO datetime)
- `holdHash` (sha256 hex; computed from the immutable core)
- `status` (`held|released|refunded`)
- `revision` (non-negative int)
- `updatedAt` (ISO datetime)

Optional:

- `resolvedAt` (ISO datetime; present when `status != held`)
- `metadata` (implementation-defined JSON object)

## Hashing

`holdHash` is computed as sha256 of the RFC 8785 canonical JSON of the **immutable core**, which excludes:

- `holdHash`
- `status`
- `resolvedAt`
- `updatedAt`
- `revision`
- `metadata`

This ensures `holdHash` is stable across state transitions.

## Invariants

- `heldAmountCents <= amountCents`
- Escrow operations must only move `heldAmountCents`.
- A `FundingHold.v1` must not be “resolved” more than once (application must be idempotent).

## Schema

See `docs/spec/schemas/FundingHold.v1.schema.json`.

