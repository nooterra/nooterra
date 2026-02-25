# SessionTranscript.v1

`SessionTranscript.v1` is a deterministic, lightweight session export for host-agnostic collaboration audits.

Runtime status: implemented.

## Purpose

Provide a portable transcript digest that can be verified without shipping full event payload bodies:

- stable session identity binding,
- event-level digest rows,
- chain/provenance verification summary,
- canonical transcript hash.

Use this when consumers need reliable lineage proof with lower payload volume than `SessionReplayPack.v1`.

## Required fields

- `schemaVersion` (const: `SessionTranscript.v1`)
- `tenantId`
- `sessionId`
- `generatedAt`
- `sessionHash`
- `transcriptEventDigestHash`
- `eventCount`
- `verification`
- `session`
- `eventDigests`
- `transcriptHash`

## `eventDigests[]` shape

Each row is a deterministic digest projection of one timeline event:

- `eventId`
- `eventType`
- `at`
- `chainHash`
- `prevChainHash` (nullable)
- `payloadHash` (nullable)
- `signerKeyId` (nullable)
- `actor` (nullable)
- `traceId` (nullable)
- `provenance` (nullable summary: `label`, `isTainted`, `taintDepth`, `reasonCodes[]`)

## Fail-closed guarantees

Transcript generation is blocked when:

- event `streamId` does not match session id,
- chain signature/hash verification fails,
- provenance-chain verification fails,
- transcript object normalization fails.

## Determinism

- `sessionHash` is canonical `sha256(session)`.
- `transcriptEventDigestHash` is canonical `sha256(eventDigests[])`.
- `transcriptHash` is canonical `sha256(top-level object without transcriptHash)`.
- repeated requests over unchanged session state yield identical `transcriptHash`.

## API surface

- `GET /sessions/:sessionId/transcript`

## MCP surface

- `settld.session_transcript_get`

## Implementation references

- `src/core/session-transcript.js`
- `src/core/session-collab.js`
- `src/api/app.js`
- `scripts/mcp/settld-mcp-server.mjs`

