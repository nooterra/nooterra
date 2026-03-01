# AgentLocator.v1

`AgentLocator.v1` is the deterministic public resolution result for turning an agent reference into a single public agent record.

Runtime status: implemented.

## Purpose

Provide a fail-closed, auditable lookup primitive for public agent references used by API, CLI, and MCP surfaces.

## Required fields

- `schemaVersion` (const: `AgentLocator.v1`)
- `agentRef` (caller input)
- `parsedRef` (`agent_id|did|url` or `null` for malformed)
- `status` (`resolved|malformed|not_found|ambiguous`)
- `reasonCode` (`AGENT_LOCATOR_MALFORMED_REF|AGENT_LOCATOR_NOT_FOUND|AGENT_LOCATOR_AMBIGUOUS|null`)
- `matchCount`
- `resolved` (single winning candidate or `null`)
- `candidates` (deterministically ranked)
- `deterministicHash` (`sha256` of canonical locator payload)

## Determinism

- parser normalization is strict and stable.
- ranking order is deterministic with explicit tie-break hashes.
- when top-ranked candidates tie, resolution fails closed with `AGENT_LOCATOR_AMBIGUOUS`.

## API surface

- `GET /v1/public/agents/resolve?agent=...`
- `GET /.well-known/agent-locator/:agentId`

## Implementation references

- `src/core/agent-locator.js`
- `src/api/app.js`
- `src/api/openapi.js`
