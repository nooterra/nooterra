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
- `createdAt`
- `updatedAt`
- `revision`

## Enumerations

- `status`: `active|suspended|revoked`
- `visibility`: `public|tenant|private`

## Invariants

- `capabilities` MUST be a subset of the registered `AgentIdentity.v1` capabilities.
- `agentId` MUST reference an existing agent identity.
- `updatedAt` MUST move forward monotonically per card revision.
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
- Tool descriptor filters are supported on discover endpoints:
  - `toolId`
  - `toolMcpName`
  - `toolRiskClass`
  - `toolSideEffecting`
  - `toolMaxPriceCents`
  - `toolRequiresEvidenceKind`
- Invalid discovery query filters fail closed with `SCHEMA_INVALID`.
- Public stream updates use `AgentCardStreamEvent.v1` (`agent_card.upsert`, `agent_card.removed`).

## Public publish anti-abuse controls

- Public listing transitions (`non-public -> public`) can be rate-limited with:
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_WINDOW_SECONDS`
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_MAX_PER_TENANT`
  - `PROXY_AGENT_CARD_PUBLIC_PUBLISH_MAX_PER_AGENT`
- When exceeded, publish fails closed with `AGENT_CARD_PUBLIC_PUBLISH_RATE_LIMITED`.

## MCP surface

- `settld.agent_card_upsert`
- `settld.agent_discover`

## Implementation references

- `src/core/agent-card.js`
- `src/api/app.js`
- `src/api/openapi.js`
