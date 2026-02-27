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
- `signature` (optional `SessionReplayPackSignature.v1`)

## Verification semantics

Replay-pack generation is fail-closed when:

- any event `streamId` differs from `sessionId`,
- chained signature/hash verification fails,
- provenance-chain verification fails,
- replay-pack normalization fails.

`packHash` is canonical `sha256` over replay-pack content with `packHash` omitted.
When present, `signature.payloadHash` must equal `packHash`.

## Determinism notes

- `sessionHash` is canonical `sha256(session)`.
- `eventChainHash` is canonical `sha256(events[])`.
- `generatedAt` derives from the latest event timestamp when available, otherwise session timestamps.
- verification summaries include chain and provenance counters for deterministic comparisons.
- optional signatures use deterministic Ed25519 over `packHash`.

## Portable Memory Export/Import (`SessionMemoryExport.v1`)

Long-horizon session memory migration uses a deterministic companion contract:

- `schemaVersion` (const: `SessionMemoryExport.v1`)
- `tenantId`, `sessionId`, `exportedAt`
- `replayPackHash`, `replayPackRef` (`ArtifactRef.v1`, `artifactHash == replayPackHash`)
- `transcriptHash` + `transcriptRef` (both nullable, but must be set together)
- `eventCount`, `firstEventId`, `lastEventId`, `firstPrevChainHash`, `headChainHash`
- `continuity.previousHeadChainHash`, `continuity.previousPackHash`

Import verification is fail-closed:

- replay-pack hash/ref mismatch,
- event window mismatch (`eventCount`, `firstPrevChainHash`, `headChainHash`),
- chain continuity mismatch (`continuity.previousHeadChainHash`),
- transcript missing when referenced,
- transcript/replay semantic drift,
- invalid or missing required signatures when signature verification is requested.

Stable import reason codes are emitted from `SESSION_MEMORY_IMPORT_REASON_CODES` in `src/core/session-replay-pack.js`.

Roundtrip determinism guarantee:

- building `SessionMemoryExport.v1` from identical replay/transcript inputs yields identical canonical JSON,
- verified imports can be re-exported without semantic or cryptographic drift.

## API surface

- `GET /sessions/:sessionId/replay-pack`
  - optional query: `sign=true`
  - optional query: `signerKeyId=<keyId>` (requires `sign=true`)

## MCP surface

- `nooterra.session_replay_pack_get` (`sign`, `signerKeyId` optional)

## Implementation references

- `src/core/session-replay-pack.js`
- `src/core/session-collab.js`
- `src/api/app.js`
- `src/api/openapi.js`
