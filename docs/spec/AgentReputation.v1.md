# AgentReputation.v1

`AgentReputation.v1` defines a deterministic trust snapshot for a tenant-scoped agent identity.

It is computed from:

- run lifecycle outcomes (`AgentRun.v1`),
- evidence coverage signals (`AgentRun.v1.evidenceRefs`),
- escrow/settlement outcomes (`AgentRunSettlement.v1`).

## Schema

See `schemas/AgentReputation.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `AgentReputation.v1`)
- `agentId`
- `tenantId`
- `trustScore` (`0..100`)
- `riskTier` (`low|guarded|elevated|high`)
- run counters (`totalRuns`, `terminalRuns`, `createdRuns`, `runningRuns`, `completedRuns`, `failedRuns`)
- evidence + settlement counters
- score rates (`runCompletionRatePct`, `evidenceCoverageRatePct`, `settlementReleaseRatePct`)
- `scoreBreakdown`
- `computedAt`

## Score semantics (v1)

`trustScore` is a weighted score over bounded integer components:

- run quality (terminal completion rate),
- settlement quality (release rate over resolved settlements),
- evidence quality (terminal runs carrying evidence),
- activity score (bounded by run volume).

Weights in v1 are deterministic and fixed by implementation:

- run quality: 55%
- settlement quality: 30%
- evidence quality: 10%
- activity score: 5%

## Rate nullability

The following fields are `null` when no denominator exists:

- `runCompletionRatePct` (no terminal runs),
- `evidenceCoverageRatePct` (no terminal runs),
- `settlementReleaseRatePct` (no resolved settlements),
- `avgRunDurationMs` (no terminal runs with valid start/end timestamps).

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
