# API Surface

## Onboarding Runtime Loop

- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap`
- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap/smoke-test`
- `POST /v1/tenants/{tenantId}/onboarding/first-paid-call`
- `GET /v1/tenants/{tenantId}/onboarding/first-paid-call/history`
- `POST /v1/tenants/{tenantId}/onboarding/conformance-matrix`

## Authorization and Spend

- `POST /x402/wallets/:walletId/authorize`
- `POST /x402/gate/authorize-payment`
- `POST /x402/gate/verify`
- `POST /x402/gate/reversal`

## Receipts and Evidence

- `GET /x402/receipts/:receiptId`
- `GET /x402/receipts`
- `GET /x402/receipts/export.jsonl`
- `GET /x402/receipts/:receiptId/closepack`

## Escalation and Webhooks

- `GET /x402/gate/escalations`
- `POST /x402/gate/escalations/:id/resolve`
- `POST /x402/webhooks/endpoints`
- `POST /x402/webhooks/endpoints/:id/rotate-secret`

## Lifecycle

- `POST /x402/gate/agents/:id/wind-down`

## Common Control-Plane Error Codes

- `RATE_LIMITED` with `retryAfterSeconds` for conformance abuse protection
- `INVALID_IDEMPOTENCY_KEY` for malformed idempotency values
- `RUNTIME_BOOTSTRAP_UNCONFIGURED` when API base URL / ops token is missing
- `MCP_SMOKE_TEST_FAILED` when MCP initialize/tools listing fails
- `SETTLD_API_CALL_FAILED` for upstream action failures in paid flow steps
