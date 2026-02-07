# PricingMatrixSignatures.v1

This document provides a **buyer signature surface** for pricing terms.

It is stored at:

- `pricing/pricing_matrix_signatures.json` within Invoice bundles.

`PricingMatrixSignatures.v1` is **legacy**: it binds to raw file bytes, so reformatting `pricing/pricing_matrix.json` (pretty-print/minify/different serializer) changes the binding hash.

New bundles SHOULD use `PricingMatrixSignatures.v2` (canonical JSON binding; formatting-independent). See `PricingMatrixSignatures.v2.md`.

## Binding target

`PricingMatrixSignatures.v1` binds to the exact bytes of:

- `pricing/pricing_matrix.json`

The binding hash is:

- `pricingMatrixHash` — **sha256 hex of raw file bytes** of `pricing/pricing_matrix.json` (the same value committed in the bundle `manifest.json` entry for that file).

Each signature in `signatures[]` signs the `pricingMatrixHash` (bytes of the 32-byte sha256 digest) using Ed25519.

## Strict vs non-strict

- **Strict**: verifiers MUST reject this legacy schema version (hard failure). Use `PricingMatrixSignatures.v2` instead.
- **Non-strict**: verifiers MAY accept this legacy schema version for compatibility, but MUST emit warning `WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY`. Missing signatures MAY be accepted with warning `PRICING_MATRIX_UNSIGNED_LENIENT`.

Invalid signatures are hard failures (security invariant).
