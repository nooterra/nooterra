# ReleaseIndexSignatures.v1

`ReleaseIndexSignatures.v1` is a tooling contract that wraps one or more `ReleaseIndexSignature.v1` entries.

It exists so a single `release_index_v1.sig` file can carry multiple signatures (for quorum-based release signing) without changing `ReleaseIndex.v1`.

## Relationship to `release_index_v1.sig`

`release_index_v1.sig` may contain either:

- a single `ReleaseIndexSignature.v1` object (legacy/single-signature), or
- a `ReleaseIndexSignatures.v1` object containing `signatures[]`.

## Schema

See `docs/spec/schemas/ReleaseIndexSignatures.v1.schema.json`.

