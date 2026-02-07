# AgentReputation.v2

`AgentReputation.v2` extends `AgentReputation.v1` with explicit time windows so discovery and ranking can prioritize recent reliability.

## Schema

See `schemas/AgentReputation.v2.schema.json`.

## Motivation

`AgentReputation.v1` is all-time only. Marketplace ranking needs recency-aware scoring to prevent stale historical performance from dominating fresh outcomes.

`AgentReputation.v2` adds:

- fixed windows: `7d`, `30d`, `allTime`,
- a `primaryWindow` selector,
- top-level `trustScore`/`riskTier` projected from `primaryWindow`.

## Required fields

- `schemaVersion` (const: `AgentReputation.v2`)
- `agentId`
- `tenantId`
- `primaryWindow` (`7d|30d|allTime`)
- `trustScore` (`0..100`)
- `riskTier` (`low|guarded|elevated|high`)
- `windows` (object with required keys: `7d`, `30d`, `allTime`)
- `computedAt`

Each `windows.<window>` entry includes the same deterministic metrics surface as `AgentReputation.v1` (counts, rates, score breakdown, trust score).

## Window semantics

- `7d`: includes events with observed timestamps in the trailing 7 days.
- `30d`: includes events with observed timestamps in the trailing 30 days.
- `allTime`: includes all observations.

Run observations use terminal time when available (`completedAt` or `failedAt`) and fall back to run update timestamps.
Settlement observations use `resolvedAt` for resolved states and `lockedAt` for locked states.

## Compatibility

- `AgentReputation.v1` remains stable for existing integrations.
- APIs may default to `v1` for back-compat and require explicit `reputationVersion=v2` for windowed behavior.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
