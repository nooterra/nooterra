# Quickstart

This guide gets you from zero to a first verified receipt with the fewest steps.

## 1) Prerequisites

- Node.js 20+
- Public default: no API keys needed before setup
- Advanced/non-interactive: explicit `--base-url`, `--tenant-id`, and key/bootstrap flags

## 2) Guided setup (recommended)

```bash
npx nooterra setup
```

The wizard writes host config, wires MCP env, applies starter profile `engineering-spend` (unless skipped), and runs smoke by default.

Choose `quick` mode for minimal prompts:

1. host
2. wallet mode
3. OTP login/signup
4. guided wallet fund and first paid-call check

## 3) Non-interactive setup (CI / scripted)

```bash
npx nooterra setup \
  --non-interactive \
  --host openclaw \
  --wallet-mode managed \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --nooterra-api-key sk_live_xxx.yyy \
  --profile-id engineering-spend \
  --smoke
```

`--host` values: `nooterra`, `claude`, `cursor`, `openclaw`

Useful flags:

- `--skip-profile-apply`: host wiring only
- `--wallet-mode byo`: use existing wallet env keys
- `--wallet-mode none`: trust-only setup first
- `--dry-run`: preview file writes
- `--report-path ./artifacts/setup-report.json`: write setup report

## 4) Verify runtime + first paid path

```bash
nooterra login
npm run mcp:probe -- --call nooterra.about '{}'
npm run demo:mcp-paid-exa
nooterra x402 receipt verify /tmp/nooterra-first-receipt.json --format json
```

## 5) Expected outcome

- Host can call `nooterra.about`
- Starter profile is applied (or intentionally skipped)
- First paid run returns deterministic IDs such as `gateId`, `decisionId`, `settlementReceiptId`
- Receipt verification succeeds

## Optional: hosted onboarding API loop (Magic Link service)

```bash
# 1) Mint runtime bootstrap env + optional runtime API key
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap \
  -d '{"apiKey":{"create":true,"description":"quickstart runtime"}}'

# 2) MCP smoke
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap/smoke-test \
  -d '{"env":{"NOOTERRA_BASE_URL":"http://127.0.0.1:3000","NOOTERRA_TENANT_ID":"<tenant_id>","NOOTERRA_API_KEY":"<runtime_key>"}}'

# 3) First paid call
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call \
  -d '{}'

# 4) Host conformance matrix
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "x-idempotency-key: matrix_quickstart_1" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/conformance-matrix \
  -d '{"targets":["nooterra","claude","cursor","openclaw"]}'
```
