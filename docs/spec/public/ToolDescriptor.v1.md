# ToolDescriptor.v1

`ToolDescriptor.v1` is the typed per-tool routing descriptor embedded in `AgentCard.v1`.

Runtime status: implemented.

## Purpose

`ToolDescriptor.v1` lets discovery/routing systems match on specific tool traits instead of only coarse capability strings.

## Required fields

- `schemaVersion` (const: `ToolDescriptor.v1`)
- `toolId`
- `sideEffecting`
- `requiresEvidenceKinds`

## Optional fields

- `mcpToolName`
- `name`
- `description`
- `riskClass` (`read|compute|action|financial`)
- `pricing` (`amountCents`, `currency`, `unit`)
- `metadata`

## Invariants

- `toolId` MUST be non-empty.
- `riskClass`, if set, MUST be one of `read|compute|action|financial`.
- `requiresEvidenceKinds[]`, if set, MUST be from `artifact|hash|verification_report`.
- `pricing.amountCents`, if set, MUST be a non-negative safe integer.

## Discovery filters

Supported query parameters on `/agent-cards/discover` and `/public/agent-cards/discover`:

- `toolId`
- `toolMcpName`
- `toolRiskClass`
- `toolSideEffecting`
- `toolMaxPriceCents`
- `toolRequiresEvidenceKind`

Invalid filter values fail closed with `SCHEMA_INVALID`.

## Implementation references

- `src/core/agent-card.js`
- `src/api/app.js`
- `src/api/openapi.js`
- `scripts/mcp/nooterra-mcp-server.mjs`
