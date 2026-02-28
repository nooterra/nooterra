# AgentCard.v1

`AgentCard.v1` is the discovery profile for an agent identity.

Runtime status: implemented.

## Purpose

`AgentCard.v1` lets a caller discover:

- who the agent is,
- what capabilities it advertises,
- where it can be reached,
- whether it is active and visible.
- which typed tools it exposes (`ToolDescriptor.v1`) for fine-grained routing.

## Required fields

- `schemaVersion` (const: `AgentCard.v1`)
- `tenantId`
- `agentId`
- `displayName`
- `status`
- `visibility`
- `capabilities`
- `executionCoordinatorDid` (optional DID-like coordinator hint for federation-aware routing)
- `createdAt`
- `updatedAt`
- `revision`

## Enumerations

- `status`: `active|suspended|revoked`
- `visibility`: `public|tenant|private`

## Invariants

- `capabilities` MUST be a subset of the registered `AgentIdentity.v1` capabilities.
- Each `capabilities[]` entry MUST follow the shared capability identifier policy:
  - legacy non-URI strings are accepted for backward safety.
  - URI form MUST be `capability://<namespace>[@vN]` with lowercase constrained namespace.
  - reserved namespace and segment/length policy violations fail closed.
- `agentId` MUST reference an existing agent identity.
- `updatedAt` MUST move forward monotonically per card revision.
- if present, `executionCoordinatorDid` MUST be a DID-like identifier (`:` required).
- If present, `tools[].toolId` MUST be unique within a card.
- If present, each `tools[]` entry MUST validate as `ToolDescriptor.v1`.

## API surface

- `POST /agent-cards`
- `GET /agent-cards`
- `GET /agent-cards/discover`
- `GET /public/agent-cards/discover`
- `GET /public/agent-cards/stream`

## Public discovery rules

- `/public/agent-cards/discover` is cross-tenant and returns `visibility=public` cards only.
- Non-public visibility filters are rejected fail-closed (`SCHEMA_INVALID`).
- Agents under active emergency quarantine are excluded from public discoverability.
- `capability` query filters on discover endpoints use the same capability identifier policy as `capabilities[]`.
- Invalid capability scheme/format/reserved namespace/segment+length inputs fail closed (`SCHEMA_INVALID`) with deterministic reason-code-like detail messaging.
- Tool descriptor filters are supported on discover endpoints:
  - `executionCoordinatorDid`
  - `toolId`
  - `toolMcpName`
  - `toolRiskClass`
  - `toolSideEffecting`
  - `toolMaxPriceCents`
  - `toolRequiresEvidenceKind`
- Invalid discovery query filters fail closed with `SCHEMA_INVALID`.
- Public stream updates use `AgentCardStreamEvent.v1` (`agent_card.upsert`, `agent_card.removed`).
- `/public/agent-cards/stream` supports `executionCoordinatorDid` filter for coordinator-aware subscriptions.

## Public publish anti-abuse controls

- Public listing transitions (`non-public -> public`) can be rate-limited with:
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_WINDOW_SECONDS`
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_MAX_PER_TENANT`
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_MAX_PER_AGENT`
- When exceeded, publish fails closed with `AGENT_CARD_PUBLIC_PUBLISH_RATE_LIMITED`.

## Public discovery anti-abuse controls

- Public discovery can be rate-limited with:
  - `PROXY_AGENT_CARD_PUBLIC_DISCOVERY_WINDOW_SECONDS`
  - `PROXY_AGENT_CARD_PUBLIC_DISCOVERY_MAX_PER_KEY`
- When exceeded, discovery fails closed with `AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED`.
- Optional paid bypass (disabled by default):
  - `PROXY_AGENT_CARD_PUBLIC_DISCOVERY_PAID_BYPASS_ENABLED=1`
  - `PROXY_AGENT_CARD_PUBLIC_DISCOVERY_PAID_TOOL_ID=<toolId>`
- Bypass is only applied when:
  - request includes a valid API key, and
  - `toolId` query param exactly matches `PROXY_AGENT_CARD_PUBLIC_DISCOVERY_PAID_TOOL_ID`.

## MCP surface

- `nooterra.agent_card_upsert`
- `nooterra.agent_discover` (supports `scope=tenant|public`; public scope requires `visibility=public`)

## Implementation references

- `src/core/agent-card.js`
- `src/api/app.js`
- `src/api/openapi.js`
