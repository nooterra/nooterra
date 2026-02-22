# Quickstart

This guide gets you from zero to a first verified receipt with the fewest steps.

## 1) Prerequisites

- Node.js 20+
- Settld API base URL (local default: `http://127.0.0.1:3000`)
- Tenant ID (local default: `tenant_default`)
- Auth path:
  - Tenant runtime key: `--settld-api-key <keyId.secret>`
  - Or bootstrap key (mint runtime key during setup): `--bootstrap-api-key <admin_key>`

## 2) Guided setup (recommended)

```bash
npx settld setup
```

The wizard writes host config, wires MCP env, applies starter profile `engineering-spend` (unless skipped), and runs smoke by default.

## 3) Non-interactive setup (CI / scripted)

```bash
npx settld setup \
  --non-interactive \
  --host openclaw \
  --wallet-mode managed \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --settld-api-key sk_live_xxx.yyy \
  --profile-id engineering-spend \
  --smoke
```

`--host` values: `codex`, `claude`, `cursor`, `openclaw`

Useful flags:

- `--skip-profile-apply`: host wiring only
- `--wallet-mode byo`: use existing wallet env keys
- `--wallet-mode none`: trust-only setup first
- `--dry-run`: preview file writes
- `--report-path ./artifacts/setup-report.json`: write setup report

## 4) Verify runtime + first paid path

```bash
npm run mcp:probe -- --call settld.about '{}'
npm run demo:mcp-paid-exa
settld x402 receipt verify /tmp/settld-first-receipt.json --format json
```

## 5) Expected outcome

- Host can call `settld.about`
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
  -d '{"env":{"SETTLD_BASE_URL":"http://127.0.0.1:3000","SETTLD_TENANT_ID":"<tenant_id>","SETTLD_API_KEY":"<runtime_key>"}}'

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
  -d '{"targets":["codex","claude","cursor","openclaw"]}'
```
