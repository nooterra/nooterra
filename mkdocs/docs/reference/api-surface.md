# API Surface

This page summarizes the currently active public/control endpoints used by Settld workflows.

## Core Settld API (typically `:3000`)

Identity / runtime:

- `POST /agents/register`
- `GET /runs/{runId}/verification`
- `GET /runs/{runId}/settlement`

x402 flow:

- `POST /x402/gate/create`
- `POST /x402/gate/quote`
- `POST /x402/gate/authorize-payment`
- `POST /x402/gate/verify`
- `GET /x402/gate/escalations`
- `POST /x402/gate/escalations/{id}/resolve`
- `POST /x402/gate/agents/{agentId}/wind-down`

Wallet and webhook controls:

- `POST /x402/wallets/{walletId}/authorize`
- `POST /x402/webhooks/endpoints`
- `GET /x402/webhooks/endpoints`
- `POST /x402/webhooks/endpoints/{endpointId}/rotate-secret`

Ops:

- `POST /ops/api-keys`

## Hosted onboarding API (Magic Link service, typically `:3090`)

- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap`
  - Auth: `x-api-key` (bootstrap/admin key) or buyer session cookie (`ml_buyer_session`)
  - Success contract: always returns `mcp.env` with `SETTLD_BASE_URL`, `SETTLD_TENANT_ID`, `SETTLD_API_KEY`
- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap/smoke-test`
- `POST /v1/tenants/{tenantId}/onboarding/first-paid-call`
- `GET /v1/tenants/{tenantId}/onboarding/first-paid-call/history`
- `POST /v1/tenants/{tenantId}/onboarding/conformance-matrix`

## Error behavior

Common control-plane failure classes:

- `RATE_LIMITED`
- `INVALID_IDEMPOTENCY_KEY`
- `MCP_SMOKE_TEST_FAILED`
- `SETTLD_API_CALL_FAILED`
- x402 policy/verification specific fail-closed codes (returned by x402 endpoints)

## Contract source

- Generated OpenAPI: `openapi/settld.openapi.json`
- Generator command: `npm run openapi:write`
