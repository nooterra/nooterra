# PricingMatrixSignatures.v2

This document provides a **buyer signature surface** for pricing terms.

It is stored at:

- `pricing/pricing_matrix_signatures.json` within Invoice bundles.

## Binding target

`PricingMatrixSignatures.v2` binds to the canonical JSON value of:

- `pricing/pricing_matrix.json` (`PricingMatrix.v1`)

The binding hash is:

- `pricingMatrixCanonicalHash` — `sha256_hex( utf8( canonical_json_stringify(pricing_matrix_json) ) )`

Canonical JSON is RFC 8785 (JCS). See `CANONICAL_JSON.md`.

Each signature in `signatures[]` signs `pricingMatrixCanonicalHash` (bytes of the 32-byte sha256 digest) using Ed25519.

## Strict vs non-strict

- **Strict**: verifiers MUST require this file to exist and MUST require at least one valid signature from a trusted buyer pricing signer key (see `TRUST_ANCHORS.md`).
- **Non-strict**: missing signatures MAY be accepted with warning `PRICING_MATRIX_UNSIGNED_LENIENT`.

Invalid signatures are hard failures (security invariant).

