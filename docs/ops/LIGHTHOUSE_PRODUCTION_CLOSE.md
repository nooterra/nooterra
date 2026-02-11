# Lighthouse Production Close

Tracks `STLD-T180` with repo-auditable evidence.

## Source of truth

- `planning/launch/lighthouse-production-tracker.json`

## Account status model

- `targeting`
- `contracting`
- `integration_in_progress`
- `go_live_scheduled`
- `paid_production_settlement_confirmed`
- `production_active`

## Required evidence per account

- Signed commercial date (`signedAt`)
- Go-live date (`goLiveAt`)
- Production settlement reference (`productionSettlementRef`)

`productionSettlementRef` should point to a deterministic, queryable settlement artifact ID or run settlement ID.

## Launch criterion

At least 3 accounts must be in `paid_production_settlement_confirmed` or `production_active` with non-empty `productionSettlementRef`.

## Validation path

The go-live gate uses `scripts/ci/lib/lighthouse-tracker.mjs` for readiness checks and requires all active accounts to include:
- `signedAt` (valid ISO timestamp)
- `goLiveAt` (valid ISO timestamp and not earlier than `signedAt`)
- `productionSettlementRef` (non-empty)

## Update commands

Update tracker rows with validation instead of manual JSON edits:

```bash
npm run ops:lighthouse:update -- \
  --account lh_001 \
  --status paid_production_settlement_confirmed \
  --company-name "Example Co" \
  --owner "am@settld" \
  --signed-at 2026-02-10T12:00:00.000Z \
  --go-live-at 2026-02-11T15:30:00.000Z \
  --settlement-ref settle_run_abc123 \
  --notes "First paid production settlement."
```
