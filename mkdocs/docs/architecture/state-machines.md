# State Machines

Settld relies on deterministic state transitions and idempotent retries.

## 1) Paid execution flow

`create -> quote(optional) -> authorize -> verify -> settlement`

Terminal outcomes:

- `released`
- `refunded`
- `reversed`
- `locked` (until operator/dispute action)

## 2) Escalation flow

`triggered -> pending -> approved|denied -> resumed|voided`

Rules:

- Escalation decisions are signed and one-time.
- Retry does not double-settle or double-resolve.

## 3) Agent lifecycle flow

`active -> frozen -> unwind -> archived`

Used when insolvency/risk controls require immediate containment.

## 4) Queue and retry guarantees

- At-least-once delivery with idempotency keys
- Backoff + dead-letter protection
- Replay-safe processing for settlement/dispute transitions
