# AgentCard.v1

`AgentCard.v1` is the discovery profile for an agent identity.

Runtime status: implemented.

## Purpose

`AgentCard.v1` lets a caller discover:

- who the agent is,
- what capabilities it advertises,
- where it can be reached,
- whether it is active and visible.

## Required fields

- `schemaVersion` (const: `AgentCard.v1`)
- `cardId`
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

## API surface

- `POST /agent-cards`
- `GET /agent-cards`
- `GET /agent-cards/discover`

## MCP surface

- `settld.agent_card_upsert`
- `settld.agent_discover`

## Implementation references

- `src/core/agent-card.js`
- `src/api/app.js`
- `src/api/openapi.js`
