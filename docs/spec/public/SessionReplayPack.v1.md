# SessionReplayPack.v1

`SessionReplayPack.v1` is the deterministic export bundle for replaying and verifying a session timeline offline.

Runtime status: implemented.

## Purpose

Provide a portable, tamper-detectable bundle for audits, disputes, and host-agnostic verification:

- session object
- full event timeline
- chain/provenance verification summary
- canonical hash bindings

## Required fields

- `schemaVersion` (const: `SessionReplayPack.v1`)
- `tenantId`
- `sessionId`
- `generatedAt`
- `sessionHash`
- `eventChainHash`
- `eventCount`
- `verification`
- `session`
- `events`
- `packHash`

## Verification semantics

Replay-pack generation is fail-closed when:

- any event `streamId` differs from `sessionId`,
- chained signature/hash verification fails,
- provenance-chain verification fails,
- replay-pack normalization fails.

`packHash` is canonical `sha256` over replay-pack content with `packHash` omitted.

## Determinism notes

- `sessionHash` is canonical `sha256(session)`.
- `eventChainHash` is canonical `sha256(events[])`.
- `generatedAt` derives from the latest event timestamp when available, otherwise session timestamps.
- verification summaries include chain and provenance counters for deterministic comparisons.

## API surface

- `GET /sessions/:sessionId/replay-pack`

## MCP surface

- `settld.session_replay_pack_get`

## Implementation references

- `src/core/session-replay-pack.js`
- `src/core/session-collab.js`
- `src/api/app.js`
- `src/api/openapi.js`

