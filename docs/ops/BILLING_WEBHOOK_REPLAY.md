# Stripe Billing Webhook Replay Guardrail Runbook

Use this runbook when Stripe webhook ingestion shows replayable dead-letter volume or subscription drift risk.

## Preconditions

- You have `finance_read` + `finance_write` scopes for the affected tenant.
- Environment is set:
  - `SETTLD_BASE_URL`
  - `PROXY_OPS_TOKEN`
  - `SETTLD_TENANT_ID`
- `curl` and `jq` are available.

## Reproducible command set

### 1) Snapshot reconcile report

```bash
curl -sS \
  -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
  "$SETTLD_BASE_URL/ops/finance/billing/providers/stripe/reconcile/report?limit=200" | jq .
```

Focus on:
- `rejectedReasonCounts`
- `replayableRejectedCount`
- `sourceCounts`

### 2) List replay candidates

```bash
curl -sS \
  -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
  "$SETTLD_BASE_URL/ops/finance/billing/providers/stripe/dead-letter?limit=200" | jq .
```

Optional filters:
- `.../dead-letter?reason=<reason>&eventType=<eventType>&limit=200`

### 3) Dry-run replay

```bash
curl -sS -X POST \
  -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
  -H "content-type: application/json" \
  -d '{"dryRun":true,"limit":200}' \
  "$SETTLD_BASE_URL/ops/finance/billing/providers/stripe/dead-letter/replay" | jq .
```

### 4) Execute replay

```bash
curl -sS -X POST \
  -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
  -H "content-type: application/json" \
  -d '{"dryRun":false,"limit":200}' \
  "$SETTLD_BASE_URL/ops/finance/billing/providers/stripe/dead-letter/replay" | jq .
```

### 5) Validate post-replay state

```bash
curl -sS \
  -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
  "$SETTLD_BASE_URL/ops/finance/billing/providers/stripe/reconcile/report?limit=200" | jq .
```

### 6) Scripted flow (recommended)

```bash
# Dry-run (default)
scripts/dev/billing-webhook-replay.sh

# Execute replay
DRY_RUN=0 scripts/dev/billing-webhook-replay.sh

# Scoped replay by reason/event type
DRY_RUN=0 REASON=reconcile_apply_failed EVENT_TYPE=customer.subscription.updated \
  scripts/dev/billing-webhook-replay.sh
```

## On-call validation checklist

- [ ] Baseline report captured (`reconcile/report`) and incident ticket updated with snapshot.
- [ ] Replay candidate count and reasons reviewed (`dead-letter`).
- [ ] Dry-run replay performed and no schema/permission errors observed.
- [ ] Live replay executed (`dryRun=false`) with `summary.failed == 0` (or failures documented).
- [ ] Post-replay report shows expected movement in:
  - [ ] `replayableRejectedCount` (downward or unchanged with reason)
  - [ ] `ingestBreakdown.replayed` (upward)
  - [ ] `sourceCounts.dead_letter_replay` (upward)
- [ ] Tenant billing plan state verified:
  - [ ] `GET /ops/finance/billing/plan`
- [ ] Incident notes include replay scope (`reason`, `eventType`, `auditIds`) and final counts.

## Rollback / safety notes

- Replay is idempotent at event level; do not mutate historical audit rows manually.
- If replay failures increase (`dead_letter_replay_apply_failed`), stop and investigate root cause before rerunning.
- Never disable signature verification as an incident workaround.
