# Tool-Call Disputes and Holdback (Ops Runbook)

## When To Use Party Open vs Ops Override

- Use **party open** when:
  - payer/payee is within the hold challenge window
  - the dispute is expected and can be resolved by normal arbitration timelines

- Use **ops/admin override** when:
  - the challenge window is closed but funds are still held (exception path)
  - an incorrect hold configuration needs remediation
  - you need to open a case for forensic/incident reasons

Ops override requires `ops_write` and must include an explicit override reason in the case metadata.

## How Holds Get “Stuck”

A hold can remain in `held` if:

- an arbitration case exists for the hold and the case `status` is not `closed`
- the verdict has been issued but the adjustment was not applied (should be rare; indicates an idempotency/DB failure)
- escrow balances are inconsistent (wallet has insufficient escrow locked to complete release/refund)

## Debug Checklist

1. Identify the `holdHash`:
   - from the hold record (FundingHold.v1)
   - or from the arbitration case metadata (`metadata.holdHash`)
2. List tool-call arbitration cases for the agreement:
   - `GET /tool-calls/arbitration/cases?agreementHash=...`
3. Verify the case metadata:
   - `caseType: "tool_call"`
   - `agreementHash`, `receiptHash`, `holdHash` are present and 64-hex sha256
4. If the case is not closed, the auto-release tick will skip the hold.

## Maintenance Tick

The tool-call holdback maintenance tick:

- will **not** auto-release holds referenced by any non-closed tool-call arbitration case
- will skip holds whose challenge window has not yet ended
- operates on held escrow funds only

Endpoint:

- `POST /ops/maintenance/tool-call-holdback/run`

Suggested alerting:

- Alert on `tool_call_holdback_auto_release_skipped_total{reason="arbitration_case_open"}` growth without a corresponding decrease in open case count.
- Alert on holds blocked beyond an SLA threshold (derive from hold `createdAt` and current time).

