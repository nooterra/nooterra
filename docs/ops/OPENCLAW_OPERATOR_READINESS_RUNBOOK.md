# OpenClaw Operator Readiness Runbook

This runbook defines the hosted + self-host readiness gate path for OpenClaw-first distribution.

## Goal

Produce one deterministic readiness artifact that binds:

1. hosted production baseline evidence (`HostedBaselineEvidence.v1`), and
2. self-host OpenClaw runtime configuration readiness.

## Inputs

Required evidence/config:

1. Hosted baseline evidence artifact from `scripts/ops/hosted-baseline-evidence.mjs`.
2. `openclaw.plugin.json` for self-host plugin runtime wiring.
3. Optional MCP config file when required runtime keys are not present in plugin config.

The gate is fail-closed: missing/invalid required evidence or missing required runtime keys blocks readiness.

## Step 1: Capture hosted baseline evidence

```bash
node scripts/ops/hosted-baseline-evidence.mjs \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --ops-token "$NOOTERRA_OPS_TOKEN" \
  --environment production \
  --out artifacts/ops/hosted-baseline-evidence-production.json
```

Required outcome:

- `type = HostedBaselineEvidence.v1`
- `status = pass`
- valid `artifactHash`

## Step 2: Run OpenClaw operator readiness gate

```bash
node scripts/ops/openclaw-operator-readiness-gate.mjs \
  --hosted-evidence artifacts/ops/hosted-baseline-evidence-production.json \
  --openclaw-plugin openclaw.plugin.json \
  --mcp-config ~/.openclaw/mcp.json \
  --out artifacts/gates/openclaw-operator-readiness-gate.json
```

If all required `NOOTERRA_*` keys are in `openclaw.plugin.json`, `--mcp-config` may be omitted.

## Gate output contract

`OpenClawOperatorReadinessGateReport.v1` fields:

1. `schemaVersion`
2. `checks[]`
3. `blockingIssues[]`
4. `verdict`
5. `artifactHash`

`artifactHash` is computed over canonical JSON of the report core, producing deterministic output for identical inputs.

## Fail-closed guidance

If gate fails, resolve all `blockingIssues` before cutover. Typical failures:

1. `hosted_evidence_missing_or_invalid`
2. `hosted_evidence_not_green`
3. `openclaw_plugin_missing` / `openclaw_plugin_invalid`
4. `mcp_config_missing_or_invalid`
5. `self_host_required_env_missing`

Required self-host runtime keys:

- `NOOTERRA_BASE_URL`
- `NOOTERRA_TENANT_ID`
- `NOOTERRA_API_KEY`

## Operator sign-off

Readiness is green only when:

1. `verdict.ok = true`, and
2. `blockingIssues` is empty.

Archive both source evidence and gate report in the same release packet for auditability.
