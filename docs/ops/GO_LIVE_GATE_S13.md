# S13 Go-Live Gate

This gate operationalizes `STLD-T182`.

## Command

```bash
RUN_THROUGHPUT_DRILL=1 \
ALLOW_THROUGHPUT_SKIP=0 \
GO_LIVE_TEST_COMMAND="node --test test/settlement-kernel.test.js && node --test test/api-e2e-ops-money-rails.test.js && node --test test/api-e2e-ops-finance-net-close.test.js && node --test test/api-e2e-ops-arbitration-workspace.test.js && node --test test/api-e2e-ops-command-center.test.js && node --test test/api-e2e-billing-plan-enforcement.test.js" \
node scripts/ci/run-go-live-gate.mjs
# required binding source for launch packet:
# node scripts/ci/run-production-cutover-gate.mjs --mode local
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

`build-launch-cutover-packet` also fail-closes unless `artifacts/gates/settld-verified-collaboration-gate.json`
is present, valid (`schemaVersion=SettldVerifiedGateReport.v1`), and `ok=true`. The packet binds that file’s
`sha256` in `sources.settldVerifiedCollaborationGateReportSha256`.

For release review, the packet now includes `requiredCutoverChecks` (`ProductionCutoverRequiredChecksSummary.v1`)
with explicit pass/fail rows for:
- `settld_verified_collaboration`
- `openclaw_substrate_demo_lineage_verified`
- `openclaw_substrate_demo_transcript_verified`
- `sdk_acs_smoke_js_verified`
- `sdk_acs_smoke_py_verified`
