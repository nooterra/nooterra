# AgentCardStreamEvent.v1

`AgentCardStreamEvent.v1` defines Server-Sent Events emitted by public agent-card streaming.

Runtime status: implemented.

## Purpose

The stream event envelope provides deterministic, resumable updates for public discovery consumers.

## Transport

- Endpoint: `GET /public/agent-cards/stream`
- Content type: `text/event-stream`
- Resume cursor: `Last-Event-ID` header or `sinceCursor` query param
- Cursor format: `updatedAt|tenantId|agentId` (URL-escaped segments)
- MCP access: `nooterra.agent_discover_stream` (bounded snapshot pull of stream events)

## Event types

- `AGENT_CARD_UPSERT`
  - SSE event name: `agent_card.upsert`
  - Emitted when a matching public card is visible in the stream query view.
  - Includes `agentCard`.

- `AGENT_CARD_REMOVED`
  - SSE event name: `agent_card.removed`
  - Emitted when a previously visible card is no longer visible for the stream query view.
  - Does not include `agentCard`.
  - `reasonCode` is currently `NO_LONGER_VISIBLE`.

## Required fields

- `schemaVersion` (const: `AgentCardStreamEvent.v1`)
- `type` (`AGENT_CARD_UPSERT|AGENT_CARD_REMOVED`)
- `scope` (const: `public`)
- `cursor`
- `tenantId`
- `agentId`

## Conditional fields

- `updatedAt` + `agentCard` when `type=AGENT_CARD_UPSERT`
- `removedAt` + `reasonCode` when `type=AGENT_CARD_REMOVED`

## Invariants

- Cursors are strictly monotonic within a stream connection.
- Resume with the last delivered cursor is idempotent.
- Invalid cursor input fails closed with `SCHEMA_INVALID`.

## Implementation references

- `src/api/app.js`
- `test/api-e2e-agent-card-stream.test.js`
