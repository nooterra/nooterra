# TrustedHostRegistry.v1

`POST /v1/integrations/install` now materializes a launch-scoped trusted host registry entry instead of acting as a static runtime lookup only.

Launch scope is intentionally narrow:

- supported runtimes: `claude-desktop` (Claude MCP) and `openclaw`
- alias inputs accepted for Claude MCP: `mcp`, `claude`, `claude-mcp`
- unsupported runtimes fail closed with `400 INVALID_TRUSTED_HOST`

Each trusted host entry tracks:

- `hostId`
- `hostName`
- `channel`
- `runtime`
- `status`
- `callbackUrls`
- `environment`
- `authModel`
- install/docs metadata needed by the host pack

Auth metadata is stored in a fail-closed, non-echoed form:

- `authModel.type` supports `none`, `client_secret`, and `bearer_token`
- raw `authModel.clientSecret` is accepted only for `client_secret`
- the public API response never returns the raw secret
- the registry stores only `clientSecretHash` plus `clientSecretLast4` for future host-auth validation
- when `authModel.type=client_secret`, Nooterra can mint a scoped host API key for Action Wallet host routes
- the sanitized registry entry publishes `authModel.keyId` and `authModel.lastIssuedAt` for the currently active host credential
- `authModel.rotate=true` rotates that scoped host credential and returns the new one-time secret in the install response
- pure host credentials are restricted to the Action Wallet host routes and fail closed on non-host routes

Callback URLs fail closed unless they are valid `http(s)` URLs. Non-localhost callbacks must use `https`.

The response remains additive:

- `integration` still returns the host install metadata
- `trustedHost` returns the sanitized registry entry
- `hostCredential` is nullable and appears only when a host credential is newly issued or rotated
- `POST /v1/integrations/{hostId}/revoke` marks a trusted host as `revoked` and revokes its scoped host credential

The registry entry schema version is `TrustedHostRegistryEntry.v1`.
