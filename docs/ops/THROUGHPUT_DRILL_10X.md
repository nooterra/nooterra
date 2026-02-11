# Throughput Drill 10x Runbook

Objective: execute `STLD-T177` as an auditable gate artifact, not a one-off benchmark.

## Command

```bash
BASE_URL=http://127.0.0.1:3000 \
OPS_TOKEN=ops_ci \
TENANTS=3 \
ROBOTS_PER_TENANT=3 \
BASELINE_JOBS_PER_MIN_PER_TENANT=10 \
THROUGHPUT_MULTIPLIER=10 \
DURATION=120s \
TARGET_P95_MS=5000 \
MAX_FAILURE_RATE=0.05 \
node scripts/ci/run-10x-throughput-drill.mjs

BASE_URL=http://127.0.0.1:3000 \
OPS_TOKEN=ops_ci \
node scripts/ci/run-10x-throughput-incident-rehearsal.mjs
```

If local `k6` is not installed, the runner automatically falls back to `docker` (`grafana/k6:0.48.0`).
Set `ALLOW_DOCKER_K6_FALLBACK=0` to require native `k6`.

## Outputs

- K6 summary: `artifacts/throughput/10x-drill-k6-summary.json`
- Gate report: `artifacts/throughput/10x-drill-summary.json`
- Incident rehearsal report: `artifacts/throughput/10x-incident-rehearsal-summary.json`

## Gate conditions

- k6 exits with status `0`
- `http_req_duration p(95)` <= `TARGET_P95_MS`
- `http_req_failed rate` <= `MAX_FAILURE_RATE`
- ingest rejection rate <= `MAX_INGEST_REJECTED_PER_MIN`

## Incident rehearsal checklist

- Run `node scripts/ci/run-10x-throughput-incident-rehearsal.mjs` immediately after the load drill.
- Confirm `artifacts/throughput/10x-incident-rehearsal-summary.json` has `verdict.ok=true`.
- Verify rehearsal checks are green:
  - degraded-mode signal was emitted,
  - rollback returned active policy to stable,
  - communications markers were captured in `/ops/audit`,
  - command-center post-rollback breach count is zero.
