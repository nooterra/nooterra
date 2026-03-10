# ActionWalletIdempotency.v1

This document freezes the Action Wallet v1 idempotency contract for launch-critical write routes.

The v1 alias layer supports idempotency on these endpoints:

- `POST /v1/action-intents`
- `POST /v1/action-intents/{actionIntentId}/approval-requests`
- `POST /v1/approval-requests/{requestId}/decisions`
- `POST /v1/execution-grants/{executionGrantId}/evidence`
- `POST /v1/execution-grants/{executionGrantId}/finalize`
- `POST /v1/disputes`
- `POST /v1/integrations/install`

The routes remain callable without `x-idempotency-key`. When the header is present, the server enforces deterministic replay and fail-closed conflict handling.

## Scope Key

An Action Wallet idempotency record is scoped by the tuple:

`(tenantId, principalId, endpoint, x-idempotency-key)`

- `tenantId` is the effective tenant on the request.
- `principalId` is the normalized caller principal from `x-proxy-principal-id`, defaulting to `anon` when absent.
- `endpoint` is the exact launch alias route expressed as `METHOD path`.
- `x-idempotency-key` is the caller-supplied replay key.

Reusing the same key across different endpoints or principals does not collide because the scope key changes.

## Request Hash

Within a scope key, Nooterra computes a deterministic request hash from:

- HTTP method
- request path
- canonical JSON request body
- `expectedPrevChainHash` only when a route binds idempotency to chain continuity

The current Action Wallet v1 alias routes use `expectedPrevChainHash = null`, so method, path, and canonical body fully determine the replay hash.

## Replay And Conflict Rules

- If the same scope key is reused with the same request hash, Nooterra returns the original status code and response body exactly.
- If the same scope key is reused with a different request hash, Nooterra fails closed with `409` and `idempotency key conflict`.
- If the key itself is malformed, Nooterra fails closed with `400` and `invalid idempotency key`.

This means callers can safely retry network-lost writes without risking duplicate launch actions, but cannot silently mutate the request under an already-used key.

## Storage And Retention

Action Wallet idempotency records are persisted in the shared idempotency store and written through the transaction log / database-backed persistence path when available.

The launch alias layer does not define a protocol-level TTL or expiry window for idempotency records. Records persist until the backing store or retention policy removes them.
