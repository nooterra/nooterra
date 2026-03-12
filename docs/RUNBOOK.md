# Nooterra Operations Runbook

## Quick reference

| Symptom | Likely cause | Action |
|---|---|---|
| `outbox_pending_gauge` growing | downstream down or worker stuck | check `/ops/status`, check delivery logs, restart worker |
| `delivery_dlq_pending_total_gauge` > 0 | repeated delivery failures | inspect DLQ; fix destination; requeue (audited) |
| `ingest_rejected_total` spike | integration bug or hostile input | check `/ops/status` top reject codes; identify client from logs |
| stripe billing rejects/replayable dead-letter rising | dropped/invalid webhook windows or apply failures | follow `docs/ops/BILLING_WEBHOOK_REPLAY.md` |
| go-live gate blocked | one or more S13 checks failed | run `node scripts/ci/run-go-live-gate.mjs` + `npm run -s test:ops:nooterra-verified-gate -- --level collaboration --include-pg --out artifacts/gates/nooterra-verified-collaboration-gate.json` (or add `--bootstrap-local` for local Docker PG bootstrap) + `node scripts/ci/build-launch-cutover-packet.mjs`, inspect `artifacts/gates/s13-go-live-gate.json` + `artifacts/gates/nooterra-verified-collaboration-gate.json` + `artifacts/gates/s13-launch-cutover-packet.json` |
| `/healthz` dbOk=false | Postgres down/unreachable | fix DB connectivity; do not restart-loop workers |
| `ARTIFACT_HASH_MISMATCH` | non-determinism or duplicate IDs | **stop ingestion**, preserve state, investigate |

## Standard endpoints

- `GET /health` liveness
- `GET /healthz` health with signals
- `GET /metrics` metrics
- `GET /ops/status` backlog + DLQ + top reject codes

## Common scenarios

### Outbox backlog growing

1. `GET /ops/status` (confirm which backlog is growing).
2. Check logs for `outbox.claim`, `ledger.apply.*`, `delivery.*`.
3. If deliveries: verify destination health/auth; allow retries or move to DLQ.
4. If ledger apply: investigate DB errors; do **not** manually mutate ledger tables.

### Delivery DLQ non-zero

1. Inspect failure reason codes in DB/ops tooling (destination down, non-2xx, auth, timeout).
2. Fix destination.
3. Requeue (audited) and watch `delivery_dlq_pending_total_gauge` return to 0.

### Ingest rejects spike

1. `GET /ops/status` → identify top reject reason codes.
2. Correlate to request logs by `requestId` and tenant.
3. If attack suspected: enable/raise rate limiting; rotate/revoke keys as needed.

### Stripe billing dead-letter/replay spike

1. Run `docs/ops/BILLING_WEBHOOK_REPLAY.md` command sequence.
2. Dry-run replay first, then run live replay if dry-run is clean.
3. Confirm post-replay `reconcile/report` counters move as expected and incident log is updated.

### Settlement / artifact drift (critical)

Stop. This is a “system-of-record” incident.

Immediate actions:
1. Stop accepting new writes (ingest + event appends).
2. Preserve DB snapshot and logs.
3. Identify the job/artifact with drift.
4. Compare event stream bytes + pinned hashes; look for nondeterminism (timestamps, randomness, floats).

Do not resume ingestion until:
- root cause is fixed, and
- a regression test is added, and
- a replay produces identical hashes.

### Throughput launch drill (T177)

1. Run `node scripts/ci/run-10x-throughput-drill.mjs` with production-like env.
2. Confirm `artifacts/throughput/10x-drill-summary.json` shows `verdict.ok=true`.
3. Run `node scripts/ci/run-10x-throughput-incident-rehearsal.mjs`.
4. Confirm `artifacts/throughput/10x-incident-rehearsal-summary.json` shows `verdict.ok=true`.
5. If failed:
- inspect `http_req_duration p95`, `http_req_failed rate`, and ingest reject rate.
- keep release gate blocked until thresholds pass.

### Go-live gate (T182)

1. Run `node scripts/ci/run-go-live-gate.mjs`.
2. Run `node scripts/ci/build-launch-cutover-packet.mjs`.
3. Inspect `artifacts/gates/s13-go-live-gate.json` and `artifacts/gates/s13-launch-cutover-packet.json`.
4. Gate requires:
- deterministic critical suites pass,
- 10x throughput drill pass,
- lighthouse tracker indicates >=3 paid production settlements.
- Nooterra Verified collaboration binding source passes:
  `npm run -s test:ops:nooterra-verified-gate -- --level collaboration --include-pg --out artifacts/gates/nooterra-verified-collaboration-gate.json`
  (local alternative: append `--bootstrap-local` to auto-start loopback API + Docker Postgres)

### Release promotion input materialization (NOO-65)

Before running release promotion guard manually, materialize upstream artifacts exactly like CI:

```bash
npm run -s test:ops:release-promotion-materialize-inputs -- \
  --tests-root /tmp/release-upstream/tests \
  --go-live-root /tmp/release-upstream/go-live \
  --release-gate-root /tmp/release-upstream/release-gate \
  --report artifacts/gates/release-promotion-guard-input-materialization.json
```

Then run:

```bash
npm run -s test:ops:release-promotion-guard -- \
  --kernel-gate artifacts/gates/kernel-v0-ship-gate.json \
  --production-gate artifacts/gates/production-cutover-gate.json \
  --offline-parity-gate artifacts/gates/offline-verification-parity-gate.json \
  --onboarding-host-success-gate artifacts/gates/onboarding-host-success-gate.json \
  --go-live-gate artifacts/gates/s13-go-live-gate.json \
  --launch-packet artifacts/gates/s13-launch-cutover-packet.json \
  --baseline-evidence artifacts/ops/hosted-baseline-release-gate.json
```

## DR: backup/restore drill
Use the deterministic wrapper below to prove restore correctness and archive a machine-readable report:

```bash
npm run ops:backup-restore:drill -- \
  --tenant-id tenant_default \
  --database-url "$DATABASE_URL" \
  --restore-database-url "$RESTORE_DATABASE_URL" \
  --schema backup_launch_drill \
  --jobs 10 \
  --month 2026-03 \
  --out artifacts/ops/backup-restore-drill.json
```

Required artifact:

- `artifacts/ops/backup-restore-drill.json` with `schemaVersion="BackupRestoreDrillReport.v1"` and `status="pass"`

The report records:

- source/restore database hosts without secrets
- total runtime
- per-step timing
- blocking issues when a step or the drill exits non-zero

If you need the raw shell path directly, `scripts/backup-restore-test.sh` remains the underlying PG-mode drill.

## Launch security review

Run:

```sh
npm run ops:launch-security:review -- --out artifacts/ops/launch-security-review.json
```

This emits `LaunchSecurityReviewReport.v1` and fails closed if launch review evidence is missing for:

- managed public auth CORS allowlisting on `www.nooterra.ai` / `nooterra.ai`
- approval-link session binding, expiry, and replay rejection
- approval scope binding against canonical action/envelope hashes
- same-origin proxy routing for `__magic`, `__nooterra`, and `/v1`
- fail-closed dashboard handling when a control-plane route returns HTML instead of JSON

## Launch abuse controls report

Use the launch abuse report before opening traffic to detect:

- repeated failed approvals
- suspicious host rescue/emergency patterns
- suspicious payment mismatches from money-rail reconciliation

```bash
npm run ops:launch-abuse:report -- \
  --base-url https://api.nooterra.ai \
  --tenant-id tenant_default \
  --ops-token "$NOOTERRA_OPS_TOKEN" \
  --period "$(date -u +%Y-%m)" \
  --out artifacts/ops/launch-abuse-report.json
```

The report is fail-closed. `status="fail"` means launch stays blocked until the underlying approval, host, or payment signal is resolved or explicitly understood.

## Launch structured logging review

Run:

```sh
npm run ops:launch-structured-logging:review -- --out artifacts/ops/launch-structured-logging-review.json
```

This emits `LaunchStructuredLoggingReviewReport.v1` and fails closed if launch logging evidence is missing for:

- structured logger core JSON/redaction support
- API runtime Action Wallet / verifier / payment event logging
- magic-link startup and durability warnings
- x402 gateway startup metadata
- MCP host-pack stderr events with stable `eventId` and `reasonCode`
