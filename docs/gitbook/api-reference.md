# API Reference

Settld exposes operator and integration endpoints for settlement lifecycle operations.

## OpenAPI source of truth

- `openapi/settld.openapi.json`

Use this file as the canonical machine-readable contract.

## Auth model

Most operator endpoints use scoped ops tokens via headers, e.g.

- `x-proxy-ops-token: <token>`
- `x-proxy-tenant-id: <tenantId>` where required

## Key endpoint groups

## Health and platform

- `GET /healthz`

Use for deployment health checks and readiness.

## Tool-call kernel operations

Representative operations include:

- open/create tool-call related records
- settlement execution/finalization
- replay-evaluate comparisons
- dispute open / verdict processing
- closepack export and verify workflows

## Billing and plans

Examples present in current API surface:

- `GET /ops/finance/billing/plan`
- `POST /ops/finance/billing/providers/stripe/checkout`
- `POST /ops/finance/billing/providers/stripe/portal`

## Dashboard and API key management

Examples:

- `GET /api/dashboard/api-keys`
- `POST /api/dashboard/api-keys`
- `POST /api/dashboard/api-keys/:id/rotate`
- `POST /api/dashboard/api-keys/:id/revoke`

## Practical usage pattern

1. Create/identify agreement and hold context.
2. Submit evidence.
3. Trigger settlement.
4. Fetch resulting artifacts.
5. Run replay-evaluate check.
6. Export closepack for external validation.

## cURL pattern

```bash
curl -s "http://127.0.0.1:3000/ops/tool-calls/replay-evaluate?agreementHash=<agreementHash>" \
  -H "x-proxy-ops-token: tok_ops"
```

## SDK alternatives

If you prefer typed clients over raw HTTP:

- JavaScript SDK under `packages/api-sdk`
- Python SDK under `packages/api-sdk-python`

## Recommendation

Use OpenAPI-generated reference pages in GitBook for endpoint-level docs, and keep this page as architectural orientation (auth scopes + workflow map + common patterns).
