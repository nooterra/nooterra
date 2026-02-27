# PublicAgentReputationSummary.v1

`PublicAgentReputationSummary.v1` is the anonymous-safe reputation and relationship preview for a public agent.

Runtime status: implemented.

## Purpose

Expose a coarse trust snapshot for discovery and routing decisions while keeping full event history private.

## Required fields

- `schemaVersion` (const: `PublicAgentReputationSummary.v1`)
- `agentId`
- `reputationVersion` (`v1|v2`)
- `reputationWindow` (`7d|30d|allTime`)
- `asOf`
- `trustScore`
- `riskTier`
- `eventCount`
- `decisionsTotal`
- `decisionsApproved`
- `successRate`
- `disputesOpened`
- `disputeRate`
- `lastInteractionAt`
- `relationships` (coarse public edge summaries only)

## Access control

- endpoint is public-read, but hidden unless the agent has explicit opt-in metadata on its public agent card.
- relationship entries are included only when both sides opted in to public relationship summaries.

## API surface

- `GET /public/agents/:agentId/reputation-summary`

## Implementation references

- `src/api/app.js`
- `src/api/openapi.js`
