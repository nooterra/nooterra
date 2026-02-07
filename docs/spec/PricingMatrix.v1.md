# PricingMatrix.v1

This matrix is stored at `pricing/pricing_matrix.json` within Invoice bundles.

## Buyer approval (contract-grade terms)

Pricing terms may be buyer-approved via a detached signature surface:

- `pricing/pricing_matrix_signatures.json` (`PricingMatrixSignatures.v2` recommended)

New bundles SHOULD use `PricingMatrixSignatures.v2` (canonical JSON binding; formatting-independent).

See:

- `PricingMatrixSignatures.v2.md`
- `PricingMatrixSignatures.v1.md` (legacy; binds to raw file bytes)

## Numeric representation

- prices are expressed in minor units (e.g. cents) as base-10 integer strings (no floats).
