# Settld Operations Runbook

## Quick reference

| Symptom | Likely cause | Action |
|---|---|---|
| `outbox_pending_gauge` growing | downstream down or worker stuck | check `/ops/status`, check delivery logs, restart worker |
| `delivery_dlq_pending_total_gauge` > 0 | repeated delivery failures | inspect DLQ; fix destination; requeue (audited) |
| `ingest_rejected_total` spike | integration bug or hostile input | check `/ops/status` top reject codes; identify client from logs |
| stripe billing rejects/replayable dead-letter rising | dropped/invalid webhook windows or apply failures | follow `docs/ops/BILLING_WEBHOOK_REPLAY.md` |
| go-live gate blocked | one or more S13 checks failed | run `node scripts/ci/run-go-live-gate.mjs` + `node scripts/ci/build-launch-cutover-packet.mjs`, inspect `artifacts/gates/s13-go-live-gate.json` + `artifacts/gates/s13-launch-cutover-packet.json` |
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

## DR: backup/restore drill

Use `scripts/backup-restore-test.sh` (PG mode) to prove restore correctness.
