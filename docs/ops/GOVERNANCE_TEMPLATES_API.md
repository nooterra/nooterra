# Governance Templates API

This API adds a tenant-scoped governance template registry and a template apply command that emits `TENANT_POLICY_UPDATED` governance events.

## Endpoints

- `POST /ops/governance/templates`
  - Scope: `governance_tenant_write` or `finance_write`
  - Requires `x-idempotency-key`
  - Body fields:
    - `templateId` (required, regex `^[a-z][a-z0-9._-]{2,63}$`)
    - `templateVersion` (optional, defaults to `1`, positive safe integer)
    - `name` (required, non-empty string)
    - `policy` (required, object)
    - `description` (optional nullable string)
    - `metadata` (optional nullable object)
  - Fail-closed behavior:
    - Rejects non-object policy/metadata
    - Rejects malformed IDs/versions
    - Rejects hash-mismatched upserts for an existing `templateId+templateVersion` with `409 GOVERNANCE_TEMPLATE_CONFLICT`

- `GET /ops/governance/templates`
  - Scope: `governance_tenant_read|governance_tenant_write|finance_read|finance_write`
  - Query:
    - `templateId` optional filter
    - `latest=true|false` (`true` default)
    - `limit`, `offset`

- `GET /ops/governance/templates/:templateId`
  - Scope: same as list
  - Query: `templateVersion` optional (if omitted, latest version is returned)

- `POST /ops/governance/templates/:templateId/apply`
  - Scope: `governance_tenant_write` or `finance_write`
  - Requires:
    - `x-proxy-expected-prev-chain-hash`
    - `x-idempotency-key`
  - Body:
    - `templateVersion` optional (defaults to latest)
    - `effectiveFrom` required ISO timestamp
    - `reason` optional
  - Emits `TENANT_POLICY_UPDATED` into tenant governance stream (`monthId=governance`) with optimistic precondition.
  - Fail-closed behavior:
    - Missing precondition returns `428`
    - Stream mismatch returns `409 event append conflict`
    - Revoked template apply returns `409 GOVERNANCE_TEMPLATE_INACTIVE` with deterministic `details.reasonCode=TEMPLATE_REVOKED`
    - Effective-time semantic conflict returns `409 GOVERNANCE_EFFECTIVE_FROM_CONFLICT`

- `POST /ops/governance/templates/:templateId/revoke`
  - Scope: `governance_tenant_write` or `finance_write`
  - Requires:
    - `x-idempotency-key`
  - Body:
    - `templateVersion` optional (defaults to latest)
    - `reasonCode` required (`^[A-Z][A-Z0-9_]{2,63}$`)
    - `reason` optional nullable string
  - Behavior:
    - Marks the selected template version as `status=revoked` and records `revokedAt`, `revokedBy`, `revokeReasonCode`, `revokeReason`
  - Fail-closed behavior:
    - Missing/invalid reason code returns `400 SCHEMA_INVALID`
    - Already revoked template returns `409 GOVERNANCE_TEMPLATE_STATUS_CONFLICT` with deterministic `details.reasonCode=TEMPLATE_ALREADY_REVOKED`

## Determinism

- Template materialization is canonicalized and hash-bound (`sha256`) before persistence.
- Lifecycle denial paths return stable machine-readable `code` and deterministic `details.reasonCode`.
- List responses are sorted deterministically.
- Apply idempotency is bound to request body and expected previous governance chain hash.
