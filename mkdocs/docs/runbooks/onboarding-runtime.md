# Onboarding Runtime Loop

Production onboarding loop:

`runtime bootstrap -> MCP smoke -> first paid call -> conformance matrix`

## Fast path (CLI)

```bash
npx settld setup
```

For scripted execution:

```bash
npx settld setup \
  --non-interactive \
  --host codex \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --settld-api-key sk_live_xxx.yyy \
  --wallet-mode managed \
  --profile-id engineering-spend \
  --smoke \
  --report-path ./artifacts/setup-codex.json
```

## Hosted API path (Magic Link)

1. Runtime bootstrap:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap \
  -d '{"apiKey":{"create":true,"description":"onboarding runtime key"}}'
```

2. MCP smoke:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap/smoke-test \
  -d '{"env":{"SETTLD_BASE_URL":"http://127.0.0.1:3000","SETTLD_TENANT_ID":"<tenant_id>","SETTLD_API_KEY":"<runtime_key>"}}'
```

3. First paid call:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call \
  -d '{}'
```

4. Conformance matrix:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "x-idempotency-key: matrix_<tenant>_<build>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/conformance-matrix \
  -d '{"targets":["codex","claude","cursor","openclaw"]}'
```

## Replay / history

```bash
curl -sS -H "x-api-key: <admin_api_key>" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call/history
```

## Failure patterns

- `RUNTIME_BOOTSTRAP_UNCONFIGURED`: bootstrap service missing API/ops settings
- `MCP_SMOKE_TEST_FAILED`: runtime env or MCP wiring invalid
- `SETTLD_API_CALL_FAILED`: paid flow step failed downstream
- `RATE_LIMITED`: retry after returned interval

## Success criteria

- Setup report says host write + smoke passed
- `settld.about` callable from host
- First paid call returns deterministic IDs and settlement receipt
- Conformance matrix marks target hosts `ready=true`
