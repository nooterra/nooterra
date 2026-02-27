# ReleaseIndex.v1

`ReleaseIndex.v1` is a **signed release manifest** for Nooterra distribution artifacts.

It is a tooling contract (not a bundle protocol object). Its purpose is to make release authenticity verifiable:

- A third party can verify the `ReleaseIndex.v1` signature (rooted in a release signing key).
- A third party can verify that the release artifacts match the hashes recorded in the index.

## Files

Releases publish:

- `release_index_v1.json` — the `ReleaseIndex.v1` document
- `release_index_v1.sig` — detached signatures over the canonical JSON bytes of `release_index_v1.json` (single or quorum)

## Canonicalization and signing

- Canonical JSON: RFC8785/JCS-style canonicalization (sorted object keys; no `-0` / non-finite numbers).
- Signature is over the **SHA-256 digest** of the canonical JSON UTF-8 bytes.

## Relationship to circularity

`ReleaseIndex.v1` intentionally **does not list** itself or its signature as artifacts, to avoid circular hashing.

## Schema

See:

- `docs/spec/schemas/ReleaseIndex.v1.schema.json`
- `docs/spec/schemas/ReleaseIndexSignature.v1.schema.json`
- `docs/spec/schemas/ReleaseIndexSignatures.v1.schema.json`
