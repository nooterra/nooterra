# Onboarding Runtime Loop

This runbook covers the production onboarding control loop:

`runtime bootstrap -> MCP smoke -> first paid call -> conformance matrix`

## Prerequisites

- Control plane admin API key (`x-api-key`)
- Tenant ID
- Settld API + ops token configured on Magic Link service
- MCP server executable available (`npx -y settld-mcp`)

## Golden Path

1. Generate runtime credentials:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap \
  -d '{"apiKey":{"create":true,"description":"onboarding runtime key"}}'
```

2. Run MCP smoke test:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/runtime-bootstrap/smoke-test \
  -d '{"env":{"SETTLD_BASE_URL":"<api_base_url>","SETTLD_TENANT_ID":"<tenant_id>","SETTLD_API_KEY":"<runtime_key>"}}'
```

3. Run first paid flow:

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call \
  -d '{}'
```

4. Run conformance matrix (recommended with idempotency key):

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "x-idempotency-key: matrix_<tenant_id>_<build_id>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/conformance-matrix \
  -d '{"targets":["codex","claude","openhands"]}'
```

## Replay and History

- Read first paid call history:

```bash
curl -sS \
  -H "x-api-key: <admin_api_key>" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call/history
```

- Replay a prior first paid call attempt (no new spend attempt):

```bash
curl -sS -X POST \
  -H "x-api-key: <admin_api_key>" \
  -H "content-type: application/json" \
  http://127.0.0.1:3090/v1/tenants/<tenant_id>/onboarding/first-paid-call \
  -d '{"replayAttemptId":"fpc_<attempt_id>"}'
```

## Failure Playbook

- `RUNTIME_BOOTSTRAP_UNCONFIGURED`
  - Verify `MAGIC_LINK_SETTLD_API_BASE_URL` and `MAGIC_LINK_SETTLD_OPS_TOKEN` are both set.

- `MCP_SMOKE_TEST_FAILED`
  - Confirm env values from bootstrap output are unmodified.
  - Confirm MCP package is resolvable in runtime host.

- `SETTLD_API_CALL_FAILED` / step-specific paid-call failure
  - Check response `step` and `message`.
  - Re-run first paid call and compare attempt history.

- `RATE_LIMITED` on conformance matrix
  - Honor `retryAfterSeconds`.
  - Reduce automated matrix frequency.
  - Use `x-idempotency-key` to safely retry same operation.

- `INVALID_IDEMPOTENCY_KEY`
  - Ensure key is single-line and <= 160 chars.

## Audit Expectations

After successful runs, audit logs should contain:

- `TENANT_RUNTIME_BOOTSTRAP_ISSUED`
- `TENANT_RUNTIME_MCP_SMOKE_TESTED`
- `TENANT_RUNTIME_FIRST_PAID_CALL_COMPLETED`
- `TENANT_RUNTIME_CONFORMANCE_MATRIX_RUN`
