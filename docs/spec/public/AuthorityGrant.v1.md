# AuthorityGrant.v1

`AuthorityGrant.v1` is a bounded principal-to-agent authority contract.

Runtime status: implemented and enforced when referenced by x402 authorize and work-order creation paths.

## Purpose

`AuthorityGrant.v1` defines:

- principal identity (`principalRef`),
- grantee execution authority (`granteeAgentId`),
- allowed risk and execution scope,
- spend envelope limits,
- delegation-chain constraints,
- validity and revocation.

## Required fields

- `schemaVersion` (const: `AuthorityGrant.v1`)
- `grantId`
- `tenantId`
- `principalRef`
- `granteeAgentId`
- `scope`
- `spendEnvelope`
- `chainBinding`
- `validity`
- `revocation`
- `createdAt`
- `grantHash`

## Principal model

- `principalRef.principalType` in `human|org|service|agent`
- `principalRef.principalId`

## Scope model

- `scope.allowedProviderIds` (optional)
- `scope.allowedToolIds` (optional)
- `scope.allowedRiskClasses` (required)
- `scope.sideEffectingAllowed` (required)

Risk classes:

- `read`
- `compute`
- `action`
- `financial`

## Spend envelope

- `spendEnvelope.currency`
- `spendEnvelope.maxPerCallCents`
- `spendEnvelope.maxTotalCents`

Runtime enforces both per-call and cumulative spend bounds.

## Chain binding

- `chainBinding.rootGrantHash`
- `chainBinding.parentGrantHash` (nullable)
- `chainBinding.depth`
- `chainBinding.maxDelegationDepth`

## Revocation

Revocation is explicit and terminal for authorization enforcement.

## API surface

- `POST /authority-grants`
- `GET /authority-grants`
- `GET /authority-grants/:grantId`
- `POST /authority-grants/:grantId/revoke`

## MCP surface

- `settld.authority_grant_issue`
- `settld.authority_grant_get`
- `settld.authority_grant_list`
- `settld.authority_grant_revoke`

## Implementation references

- `src/core/authority-grant.js`
- `src/api/app.js`
- `src/api/openapi.js`
