# Sprint 21: Tool-Call Disputes Integrated With Holdback

This doc is the implementation tracker for Sprint 21 (tool-call disputes in the holdback loop).

## Goal

Integrate tool-call disputes into the holdback challenge window so that:

- payer/payee can open a dispute during the challenge window (ops can override),
- open arbitration cases freeze holdback auto-release,
- verdict issuance deterministically creates exactly one `SettlementAdjustment` per `agreementHash`,
- adjustments operate on held funds only (no negative balances, no clawbacks),
- handlers are idempotent and race-safe.

## Modeling

ArbitrationCase metadata convention for tool-call cases:

```json
{
  "caseType": "tool_call",
  "agreementHash": "<sha256hex>",
  "receiptHash": "<sha256hex>",
  "holdHash": "<sha256hex>"
}
```

Deterministic synthetic IDs (schema compatibility):

- `runId = tc_${agreementHash}`
- `settlementId = setl_tc_${agreementHash}`
- `disputeId = disp_tc_${agreementHash}`
- default `caseId = arb_case_tc_${agreementHash}`

Deterministic adjustment ID:

- `sadj_agmt_${agreementHash}_holdback`

## API Work Items

1. Tool-call arbitration case open/list/get:
   - `POST /tool-calls/arbitration/open`
   - `GET /tool-calls/arbitration/cases?agreementHash=...`
   - `GET /tool-calls/arbitration/cases/{caseId}`
2. Tool-call verdict submission:
   - `POST /tool-calls/arbitration/verdict`
   - enforce binary `releaseRatePct` (`0` payer wins, `100` payee wins)
3. Holdback maintenance tick:
   - open tool-call cases block auto-release
   - tick skips receipts referenced by open cases
4. Admin override:
   - `ops_write` can open as override outside challenge window with reason

## Storage Work Items

- Persist `FundingHold` (mutable hold lifecycle snapshot).
- Persist `SettlementAdjustment` as immutable snapshot with DB uniqueness (idempotency by deterministic `adjustmentId`).
- Extend store implementations:
  - in-memory (`src/api/store.js` + `src/api/persistence.js`)
  - pg (`src/db/store-pg.js`)

## Tests (Acceptance)

- API e2e:
  - payee opens case -> hold freeze -> verdict favors payee -> adjustment -> funds released -> hold resolved
  - payer opens case -> hold freeze -> verdict favors payer -> adjustment -> funds refunded -> hold resolved
  - idempotent verdict submission returns existing adjustment on retry
  - `ops_write` override behavior

## Runbook / Ops

- Guidance: when to use ops override vs signed party open.
- Logs + alerts for stuck holds/disputes.

