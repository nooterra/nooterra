# S13 Go-Live Gate

This gate operationalizes `STLD-T182`.

## Command

```bash
RUN_THROUGHPUT_DRILL=1 \
ALLOW_THROUGHPUT_SKIP=0 \
GO_LIVE_TEST_COMMAND="node --test test/settlement-kernel.test.js && node --test test/api-e2e-ops-money-rails.test.js && node --test test/api-e2e-ops-finance-net-close.test.js && node --test test/api-e2e-ops-arbitration-workspace.test.js && node --test test/api-e2e-ops-command-center.test.js && node --test test/api-e2e-billing-plan-enforcement.test.js" \
node scripts/ci/run-go-live-gate.mjs
node scripts/ci/build-launch-cutover-packet.mjs
```

## Required checks

- Deterministic critical test suite passes.
- 10x throughput drill report passes.
- Throughput incident rehearsal report passes.
- Lighthouse tracker shows at least 3 accounts in `paid_production_settlement_confirmed`/`production_active` with `signedAt`, `goLiveAt`, and `productionSettlementRef` populated.

## Output

- `artifacts/gates/s13-go-live-gate.json`
- `artifacts/gates/s13-launch-cutover-packet.json`

Gate is **fail-closed**: non-zero exit on any failed required check.
