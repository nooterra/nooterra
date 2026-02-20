# Quickstart

## 1) Start API Runtime

```bash
npm run dev:api
npm run dev:maintenance
```

## 2) Mint SDK Key

```bash
npx settld dev:sdk:key --print-only
```

## 3) Execute First Flow

```bash
npx settld sdk:first-run
```

## 4) Export + Verify Offline

```bash
npx settld closepack export --receipt-id rcpt_123 --out closepack.zip
npx settld closepack verify closepack.zip
```

## 5) Operator Onboarding API (Hosted Control Plane)

```bash
# 1) Mint bounded runtime config
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap \
  -d '{"apiKey":{"create":true,"description":"quickstart runtime"}}'

# 2) Smoke-test MCP initialize + tools/list
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap/smoke-test \
  -d '{"env":{"SETTLD_BASE_URL":"http://127.0.0.1:3000","SETTLD_TENANT_ID":"<tenant_id>","SETTLD_API_KEY":"<runtime_key>"}}'

# 3) Run first paid call (quote->authorize->execute->receipt->verify)
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call \
  -d '{}'

# 4) Run conformance matrix for codex/claude/openhands
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "x-idempotency-key: matrix_quickstart_1" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/conformance-matrix \
  -d '{"targets":["codex","claude","openhands"]}'
```

## Expected Outputs

- Request-bound authorization issued
- Receipt + timeline persisted immutably
- Offline verification returns enforceable lineage status
- First paid call history contains at least one `passed` attempt
- Conformance matrix reports `ready=true` for selected runtimes
