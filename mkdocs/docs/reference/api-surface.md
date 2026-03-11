# API Surface

This page summarizes the public Nooterra endpoints that matter for Action Wallet v1.

For launch, the public contract is intentionally narrow:

- create a governed action
- request hosted approval
- fetch a scoped execution grant
- finalize with evidence
- issue a receipt
- open a dispute

The supporting onboarding and money-rail endpoints exist to make that loop production-safe, not to replace it.

## Action Wallet launch lifecycle

The shortest production loop is:

1. `POST /v1/action-intents`
2. `POST /v1/action-intents/{actionIntentId}/approval-requests`
3. `GET /v1/approval-requests/{approvalRequestId}`
4. `GET /v1/action-intents/{actionIntentId}/execution-grant`
5. `POST /v1/action-intents/{actionIntentId}/finalize`
6. `GET /v1/receipts/{receiptId}`
7. `POST /v1/disputes`

Launch-supported actions:

- `buy`
- `cancel/recover`

Launch-supported hosts:

- `Claude MCP`
- `OpenClaw`

Engineering shells that reuse the same runtime:

- `Codex`
- `CLI`
- direct `REST API`

## Core Action Wallet endpoints

### Create an action intent

- `POST /v1/action-intents`

This is where the host proposes a real action. The runtime evaluates scope, trust, and policy before anything external happens.

Use idempotency on intent creation. If required launch fields are missing or the action is out of policy, the runtime fails closed.

### Create a hosted approval request

- `POST /v1/action-intents/{actionIntentId}/approval-requests`

This returns the hosted approval handoff. When the public host is known, the contract returns a real hosted `approvalUrl`, not a relative path.

### Read approval status

- `GET /v1/approval-requests/{approvalRequestId}`

Use this to confirm whether the request is still pending, approved, denied, expired, or revoked.

### Fetch the scoped execution grant

- `GET /v1/action-intents/{actionIntentId}/execution-grant`
- `GET /v1/execution-grants/{executionGrantId}`

The grant is the authority envelope. Hosts should not execute the action until the grant is present and still valid.

### Finalize the action

- `POST /v1/action-intents/{actionIntentId}/finalize`

Finalize is evidence-bound and fail-closed. Missing or mismatched required evidence blocks completion. Launch-critical verifier outcomes must still align at finalize time.

### Read the receipt

- `GET /v1/receipts/{receiptId}`

Receipts bind:

- originating approval
- execution grant
- evidence bundle
- verifier verdict
- settlement state
- dispute state

### Open a dispute

- `POST /v1/disputes`

Launch dispute intake supports Action Wallet receipt, run, work-order, and execution-grant context. It should be possible to open recourse directly from a receipt or run without operator DB inspection.

## Hosted onboarding API

Hosted onboarding runs through the Magic Link service and exists to get a user from account creation to first governed action quickly.

### Auth and runtime bootstrap

- `GET /v1/public/auth-mode`
- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap`
- `POST /v1/tenants/{tenantId}/onboarding/runtime-bootstrap/smoke-test`

Auth behavior:

- preferred web flow: buyer session cookie (`ml_buyer_session`)
- bootstrap/admin automation: `x-api-key`

Successful bootstrap always returns `mcp.env` with:

- `NOOTERRA_BASE_URL`
- `NOOTERRA_TENANT_ID`
- `NOOTERRA_API_KEY`

### First governed action loop

- `POST /v1/tenants/{tenantId}/onboarding/seed-hosted-approval`
- `POST /v1/tenants/{tenantId}/onboarding/first-paid-call`
- `GET /v1/tenants/{tenantId}/onboarding/first-paid-call/history`
- `POST /v1/tenants/{tenantId}/onboarding/conformance-matrix`

These endpoints exist so the onboarding UI can:

- seed a real hosted approval
- run the first paid call
- refresh artifact history from live runtime state
- confirm launch-host conformance

## Money and settlement endpoints

Action Wallet launch uses one hardened money lane. These endpoints stay on the core API because they are part of the deterministic settlement loop.

- `POST /x402/gate/create`
- `POST /x402/gate/quote`
- `POST /x402/gate/authorize-payment`
- `POST /x402/gate/verify`
- `GET /x402/gate/escalations`
- `POST /x402/gate/escalations/{id}/resolve`
- `POST /x402/gate/agents/{agentId}/wind-down`
- `POST /x402/wallets/{walletId}/authorize`
- `POST /x402/webhooks/endpoints`
- `GET /x402/webhooks/endpoints`
- `POST /x402/webhooks/endpoints/{endpointId}/rotate-secret`

Launch expectation:

- capture never occurs before verification passes
- provider events must stay bound to the stored operation and settlement context
- reconciliation fails closed on binding drift

## Runtime and operator support endpoints

- `POST /agents/register`
- `GET /runs/{runId}/verification`
- `GET /runs/{runId}/settlement`
- `POST /ops/api-keys`

These endpoints matter for certification, rescue, and launch operations, but they are not the first thing a host integrator should reach for.

## Error behavior

Common failure classes:

- `RATE_LIMITED`
- `INVALID_IDEMPOTENCY_KEY`
- `MCP_SMOKE_TEST_FAILED`
- `NOOTERRA_API_CALL_FAILED`
- `MONEY_RAIL_PROVIDER_EVENT_BINDING_REQUIRED`
- `SETTLEMENT_KERNEL_BINDING_INVALID`

Design expectation:

- invalid or missing evidence fails closed
- replay or scope mismatch fails closed
- runtime drift stays visible in the receipt, dispute, or operator path

## Related guides

- [Quickstart](../guides/quickstart.md)
- [Launch Host Channels](../guides/launch-host-channels.md)
- [Design Partner Onboarding Kit](../guides/design-partner-onboarding-kit.md)
- [Launch Checklist](../runbooks/launch-checklist.md)

## Contract source

- Generated OpenAPI: `openapi/nooterra.openapi.json`
- Generator command: `npm run openapi:write`
