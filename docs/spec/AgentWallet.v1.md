# AgentWallet.v1

`AgentWallet.v1` defines the deterministic balance snapshot for an autonomous agent.

The wallet is tenant-scoped and currency-scoped, and is intended for:

- funding and spend tracking,
- escrow lock accounting,
- deterministic settlement transitions.

## Schema

See `schemas/AgentWallet.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `AgentWallet.v1`)
- `walletId`
- `agentId`
- `tenantId`
- `currency`
- `availableCents`
- `escrowLockedCents`
- `totalDebitedCents`
- `totalCreditedCents`
- `revision`
- `createdAt`
- `updatedAt`

## Invariants (v1)

- `availableCents` and `escrowLockedCents` are non-negative integers.
- Escrow locks move value from `availableCents` to `escrowLockedCents`.
- Releases reduce payer `escrowLockedCents` and increase payee `availableCents`.
- Refunds reduce payer `escrowLockedCents` and increase payer `availableCents`.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
