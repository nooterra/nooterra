# IdentityTransparencyLog.v1

`IdentityTransparencyLog.v1` defines an append-only public transparency log for agent identity lifecycle changes.

Runtime status: implemented.

## Purpose

Provide deterministic, auditable inclusion proofs for public identity transitions.

## Event Types

- `create`
- `rotate`
- `revoke`
- `capability-claim-change`

Each event is recorded as an `IdentityLogEntry.v1` with:

- stable `logIndex` sequencing
- hash-linking via `prevEntryHash`
- canonical entry binding via `entryHash`

## Merkle + Checkpoint

- leaves are derived from canonical entry hashes
- root is deterministic for the full ordered log
- `IdentityLogCheckpoint.v1` binds:
  - `treeSize`
  - `rootHash`
  - head entry identity/hash
  - canonical `checkpointHash`

## Inclusion Proof

`IdentityLogProof.v1` includes:

- the full `IdentityLogEntry.v1`
- checkpoint snapshot
- sibling path (`left|right`) for Merkle inclusion
- canonical `proofHash`

Verification is fail-closed on:

- malformed proof payloads
- entry/checkpoint hash mismatch
- Merkle mismatch
- checkpoint equivocation/rollback signals

## API Surface

- `GET /v1/public/identity-log/entries`
- `GET /v1/public/identity-log/proof?entry=<entryId>`
- `GET /v1/public/identity-log/checkpoint`

## CLI Surface

- `nooterra identity log verify --entry <id> --proof <file>`

## Implementation References

- `src/core/identity-transparency-log.js`
- `src/core/merkle-tree.js`
- `src/api/app.js`
- `src/api/store.js`
- `src/db/store-pg.js`
