# ToolDescriptor.v1

`ToolDescriptor.v1` is the typed per-tool routing descriptor embedded in `AgentCard.v1`.

Runtime status: implemented.

## Purpose

`ToolDescriptor.v1` lets discovery/routing systems match on specific tool traits instead of only coarse capability strings.

## Capability namespace interoperability

When tool descriptors are used with capability-filtered discovery, capability values follow the shared policy:

- legacy non-URI capability strings remain accepted for backward safety
- URI capability form is `capability://<namespace>[@vN]`
- URI namespaces are lowercase + constrained
- invalid scheme/format/reserved namespace/segment+length cases fail closed with deterministic reason-code-like messaging

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
- `requiresEvidenceKinds[]`, if set, MUST be from `artifact|hash|verification_report|execution_attestation`.
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
