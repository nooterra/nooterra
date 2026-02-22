# ArbitrationOutcomeMapping.v1

This document freezes deterministic mapping from dispute/arbitration outcomes to settlement directives in Trust OS v1.

## Purpose

Dispute outcomes must produce one unambiguous financial directive so settlement resolution is:

- deterministic,
- replay-safe,
- auditable with stable evidence traces.

## Outcome to directive mapping

Input: `AgentRunSettlement.v1.disputeResolution` + settlement `amountCents`

- `outcome=accepted`
  - directive: `status=released`
  - `releaseRatePct=100`
  - `releasedAmountCents=amountCents`
  - `refundedAmountCents=0`
- `outcome=rejected`
  - directive: `status=refunded`
  - `releaseRatePct=0`
  - `releasedAmountCents=0`
  - `refundedAmountCents=amountCents`
- `outcome=partial`
  - financial outcome: `reversal`
  - settlement directive: `status=released`
  - requires `releaseRatePct` integer in range `1..99`
  - `releasedAmountCents=floor(amountCents * releaseRatePct / 100)`
  - `refundedAmountCents=amountCents - releasedAmountCents`
  - both released/refunded amounts must be non-zero (true split)

## Validation invariants

- `accepted` may include `releaseRatePct` only as `100`.
- `rejected` may include `releaseRatePct` only as `0`.
- `partial` must include `releaseRatePct` in `1..99`.
- `withdrawn|unresolved` must not include `releaseRatePct` and cannot derive settlement directives.
- `amountCents` must be a positive safe integer when deriving directives.

Invalid combinations fail-closed with stable error code `DISPUTE_OUTCOME_DIRECTIVE_INVALID`.

## Resolve request guardrails

For `/runs/{runId}/settlement/resolve` when a dispute directive exists:

- request `status` may be omitted (derived status is authoritative),
- explicit `status` must equal derived status,
- explicit `releaseRatePct`, `releasedAmountCents`, and `refundedAmountCents` must match derived values exactly.
- if settlement is already resolved and dispute directive is present, dispute status must be `closed`.

Status mismatch fails with `DISPUTE_OUTCOME_STATUS_MISMATCH`.
Directive amount/rate mismatch fails with `DISPUTE_OUTCOME_AMOUNT_MISMATCH`.
Resolved-settlement directive precondition mismatch fails with `TRANSITION_ILLEGAL`.

## Determinism requirements

- identical dispute inputs must generate identical directives across retries.
- idempotency replay for resolve operations must return the same settlement and decision traces.
- decision traces should include the resolved `disputeSettlementDirective` for audit.
