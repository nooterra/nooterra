# ACS-E10 Readiness Index

The ACS-E10 readiness summary artifact is the operator rollup for go-live readiness.
It binds the key hosted, onboarding, and MCP host readiness artifacts into one
machine-readable decision report.

For the self-host ACS control-plane upgrade/migration evidence path, see:
`docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md`.

## Required upstream artifacts

ACS-E10 consumes these artifacts:

1. Hosted baseline evidence:
   `artifacts/ops/hosted-baseline-evidence-production.json`
2. OpenClaw operator readiness gate:
   `artifacts/gates/openclaw-operator-readiness-gate.json`
3. Onboarding host success gate:
   `artifacts/gates/onboarding-host-success-gate.json`
4. MCP host cert matrix:
   `artifacts/ops/mcp-host-cert-matrix.json`
5. Public onboarding gate:
   `artifacts/gates/public-onboarding-gate.json`
6. Self-host upgrade/migration gate:
   `artifacts/gates/self-host-upgrade-migration-gate.json`

## Command sequence

Run this sequence in order to generate inputs and then produce the ACS-E10 summary:

```bash
npm run test:ops:public-onboarding-gate -- \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --out artifacts/gates/public-onboarding-gate.json

npm run ops:hosted-baseline:evidence -- \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --ops-token "$NOOTERRA_OPS_TOKEN" \
  --environment production \
  --out artifacts/ops/hosted-baseline-evidence-production.json

node scripts/ops/openclaw-operator-readiness-gate.mjs \
  --hosted-evidence artifacts/ops/hosted-baseline-evidence-production.json \
  --openclaw-plugin openclaw.plugin.json \
  --mcp-config ~/.openclaw/mcp.json \
  --out artifacts/gates/openclaw-operator-readiness-gate.json

npm run test:ops:onboarding-host-success-gate -- \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --api-key "$NOOTERRA_API_KEY" \
  --attempts 3 \
  --min-success-rate-pct 90 \
  --report artifacts/gates/onboarding-host-success-gate.json \
  --metrics-dir artifacts/ops/onboarding-host-success

npm run test:ci:mcp-host-cert-matrix -- \
  --report artifacts/ops/mcp-host-cert-matrix.json

npm run -s test:ops:self-host-upgrade-migration-gate

npm run test:ops:acs-e10-readiness-gate
```

## Output and fail-closed interpretation

Expected ACS-E10 report path:

`artifacts/gates/acs-e10-readiness-gate.json`

Interpretation:

- Proceed only if the ACS-E10 report is green (`ok=true`) and has no blocking
  issues.
- Missing input artifacts, invalid schema/content, hash mismatch, or upstream
  non-pass verdicts must fail closed (`ok=false` and non-zero command exit).
- Do not cut over traffic until all blocking inputs are regenerated and green.
