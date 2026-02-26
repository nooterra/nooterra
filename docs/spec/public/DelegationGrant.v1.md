# DelegationGrant.v1

`DelegationGrant.v1` is a bounded authority transfer from one agent to another.

Runtime status: implemented and enforced on paid authorization paths.

## Purpose

`DelegationGrant.v1` defines:

- delegator and delegatee,
- allowed risk and execution scope,
- spend envelope limits,
- chain-depth constraints,
- validity and revocation.

## Required fields

- `schemaVersion` (const: `DelegationGrant.v1`)
- `grantId`
- `tenantId`
- `delegatorAgentId`
- `delegateeAgentId`
- `scope`
- `spendLimit`
- `chainBinding`
- `validity`
- `revocation`
- `createdAt`
- `grantHash`

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

- `spendLimit.currency`
- `spendLimit.maxPerCallCents`
- `spendLimit.maxTotalCents`

Runtime enforces both per-call and cumulative spend bounds.

## Chain binding

- `chainBinding.rootGrantHash`
- `chainBinding.parentGrantHash` (nullable)
- `chainBinding.depth`
- `chainBinding.maxDelegationDepth`

## Revocation

Revocation is explicit and terminal for authorization enforcement.

## API surface

- `POST /delegation-grants`
- `GET /delegation-grants`
- `GET /delegation-grants/:grantId`
- `POST /delegation-grants/:grantId/revoke`

## MCP surface

- `nooterra.delegation_grant_issue`
- `nooterra.delegation_grant_get`
- `nooterra.delegation_grant_list`
- `nooterra.delegation_grant_revoke`

## Implementation references

- `src/core/delegation-grant.js`
- `src/api/app.js`
- `src/api/openapi.js`
