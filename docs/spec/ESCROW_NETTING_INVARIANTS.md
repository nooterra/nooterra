# Escrow + Netting Invariants

This document defines deterministic money invariants for escrow movement and netting windows.

It is the Sprint 0 contract for `STLD-T006`.

## Escrow wallet invariants

For wallet fields:
- `availableCents`
- `escrowLockedCents`
- `totalCreditedCents`
- `totalDebitedCents`

all values MUST remain non-negative integers.

### Lock invariant

Locking `amountCents = A` MUST satisfy:
- `availableCents' = availableCents - A`
- `escrowLockedCents' = escrowLockedCents + A`
- `totalCreditedCents' = totalCreditedCents`
- `totalDebitedCents' = totalDebitedCents`

### Release invariant (payer -> payee)

Releasing `A` from payer escrow to payee MUST satisfy:
- payer: `escrowLockedCents' = escrowLockedCents - A`
- payer: `totalDebitedCents' = totalDebitedCents + A`
- payee: `availableCents' = availableCents + A`
- payee: `totalCreditedCents' = totalCreditedCents + A`

### Refund invariant

Refunding `A` to the payer wallet MUST satisfy:
- `escrowLockedCents' = escrowLockedCents - A`
- `availableCents' = availableCents + A`
- `totalCreditedCents' = totalCreditedCents + A`

## Settlement partition invariants

For one `AgentRunSettlement.v1` with principal `amountCents = P`:

- Exactly one terminal resolution from `locked` to `released|refunded`.
- Terminal partition MUST satisfy:
  - `releasedAmountCents + refundedAmountCents = P`
  - both values are non-negative integers.
- `releaseRatePct` MUST remain integer `0..100`.

## Held exposure rollforward invariant

At period close:

`endingHeld = openingHeld + newLocks - releases - forfeits`

Rollforward generation MUST be deterministic for identical event streams.

## Netting window invariants

For each `(tenant, counterparty, currency, window)`:

- Window membership is deterministic and replay-stable.
- `windowNetCents = inflowCents - outflowCents`.
- A net close operation MUST be idempotent (same input set -> same net artifact).
- No operation may appear in more than one closed netting window.

## Failure handling invariants

- Insufficient available balance MUST fail before lock mutation.
- Insufficient escrow balance MUST fail before release/refund mutation.
- Invalid settlement partition MUST fail before persistence.
