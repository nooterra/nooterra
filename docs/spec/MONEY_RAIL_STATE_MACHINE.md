# Money Rail State Machine

This document defines the deterministic lifecycle for external money movement operations
used by payout and collection rails.

It is the Sprint 0 contract for `STLD-T001` and is intentionally provider-agnostic.

## Scope

- Direction: `payout` (Settld -> external destination), `collection` (external source -> Settld).
- Unit of execution: one money movement operation keyed by a stable idempotency key.
- Out of scope: provider-specific payload formats and credential exchange.

## Canonical states

- `initiated`: operation accepted by Settld with deterministic idempotency key.
- `submitted`: request accepted by external rail and a provider reference exists.
- `confirmed`: external rail reports committed success (terminal unless reversed).
- `failed`: external rail reports terminal failure.
- `cancelled`: operation cancelled before terminal success.
- `reversed`: operation was previously `confirmed` and then reversed/charged back.

## Allowed transitions

- `initiated` -> `submitted|failed|cancelled`
- `submitted` -> `confirmed|failed|cancelled`
- `confirmed` -> `reversed`
- `failed|cancelled|reversed` -> no further state transition

Application logic MUST reject all transitions outside this set.

## Determinism rules

- The same `(tenantId, operationId, idempotencyKey)` triple MUST resolve to one operation record.
- Replays of the same request MUST return the same terminal state and provider reference.
- State progression is monotonic; no rollback to prior non-terminal states.
- Terminal states are immutable except metadata enrichment that does not change semantic outcome.

## Required operation fields

- `operationId`: stable Settld operation identifier.
- `direction`: `payout|collection`.
- `idempotencyKey`: stable client/controller dedupe key.
- `currency` and `amountCents`.
- `state`.
- `initiatedAt`, `createdAt`, `updatedAt`.

## Reconciliation hooks

- `confirmed` operations MUST link to settlement statements via a stable reference key.
- `failed|reversed` operations MUST carry a deterministic reason code.
- Reconciliation jobs MUST consume provider statement feeds and map them to operation IDs.

## Failure semantics

- Provider transport or timeout errors are non-terminal unless explicitly declared terminal.
- Terminal mismatch between provider statement and local state is a reconciliation incident.
- Reversals/chargebacks MUST be represented as explicit `reversed` transitions, not silent edits.
