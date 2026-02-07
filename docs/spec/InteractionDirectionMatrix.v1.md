# InteractionDirectionMatrix.v1

`InteractionDirectionMatrix.v1` freezes the autonomous interaction-direction contract for Settld entity types.

This object is intentionally simple and strict: every directional pair in the `4x4` matrix is allowed.

## Schema

See `schemas/InteractionDirectionMatrix.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `InteractionDirectionMatrix.v1`)
- `entityTypes` (const array: `["agent","human","robot","machine"]`)
- `directions` (matrix object keyed by `from` then `to`)
- `directionalCount` (const: `16`)

## Semantics

- The matrix is **directional** (`from -> to`), even when currently symmetric.
- In `v1`, all `16` directional pairs are `true`.
- This object is used as a protocol invariant so new surfaces default to full cross-entity support.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
