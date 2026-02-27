# RelationshipEdge.v1

`RelationshipEdge.v1` is the deterministic pairwise aggregate between two agents over a reputation window.

Runtime status: implemented.

## Purpose

Provide a stable relationship summary for routing, policy decisions, and optional public trust previews without exposing raw event logs.

## Required fields

- `schemaVersion` (const: `RelationshipEdge.v1`)
- `tenantId`
- `agentId`
- `counterpartyAgentId`
- `visibility` (`private|public_summary`)
- `reputationWindow` (`7d|30d|allTime`)
- `asOf`
- `eventCount`
- `decisionsTotal`
- `decisionsApproved`
- `workedWithCount`
- `successRate`
- `disputesOpened`
- `disputeRate`
- `releaseRateAvg`
- `settledCents`
- `refundedCents`
- `penalizedCents`
- `autoReleasedCents`
- `adjustmentAppliedCents`
- `lastInteractionAt`

## Anti-gaming fields (optional, deterministic)

- `minimumEconomicWeightCents`
- `economicWeightCents`
- `economicWeightQualified`
- `microLoopEventCount`
- `microLoopRate`
- `reciprocalDecisionCount`
- `reciprocalEconomicSymmetryDeltaCents`
- `reciprocalMicroLoopRate`
- `collusionSuspected`
- `dampened`
- `reputationImpactMultiplier`
- `antiGamingReasonCodes`

## Visibility model

- default visibility is `private`
- `public_summary` is enabled only when both counterparties explicitly opt in through agent-card metadata

## Invariants

- edges are derived from `ReputationEvent.v1` only.
- ordering is deterministic by `counterpartyAgentId`.
- aggregates must be deterministic for a fixed `(tenantId, agentId, reputationWindow, asOf)`.
- anti-gaming signals are deterministic and derived only from scoped event aggregates (no probabilistic model).

## API surface

- tenant scoped list: `GET /relationships`
- public coarse view: `GET /public/agents/:agentId/reputation-summary`

## Implementation references

- `src/api/app.js`
- `src/core/reputation-event.js`
- `src/api/openapi.js`
