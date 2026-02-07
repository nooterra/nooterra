# Trust anchors (out-of-band)

Strict verification requires **trusted root keys** that are *not* bundled inside artifacts.

This is intentional: bundling trust anchors inside the thing being verified would create a trust-loop.

## Release authenticity trust (separate domain)

Settld release authenticity (verifying the tool distribution artifacts themselves) uses a **separate trust domain** from bundle verification.

- Release trust roots live in `trust/release-trust.json` (see `ReleaseTrust.v2.md`).
- Release verification CLI: `settld-release verify --dir <release-assets-dir> --trust-file trust/release-trust.json --format json`

Do not mix release signing keys with bundle/governance signing keys (different purpose, different blast radius).

## Governance roots (required for strict)

`GovernancePolicy.v2` and `RevocationList.v1` are signed by governance root keys that must be trusted out-of-band.

Verifier input mechanism:

- `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON`
  - JSON object mapping `keyId -> publicKeyPem`
  - required for strict verification

Recommended operational posture:

- Store the trust roots JSON (or a `trust.json` file that contains it) in version control.
- Distribute updates via PR + review (treat as a security-sensitive change).
- Pin tool versions in CI (see `docs/spec/VERSIONING.md`) so a verification receipt can be mapped to a stable tool build.
- For regulated workflows: run strict mode and gate on warnings (`--fail-on-warnings`) when policy requires it (see `STRICTNESS.md` and `WARNINGS.md`).

## Buyer pricing signer keys (required for strict InvoiceBundle pricing terms)

Invoice bundles may include buyer-approved pricing terms via `pricing/pricing_matrix_signatures.json` (`PricingMatrixSignatures.*`).

Verifier input mechanism:

- `SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON`
  - JSON object mapping `keyId -> publicKeyPem`
  - required to validate buyer pricing signatures in strict mode

Optional restriction:

- `SETTLD_TRUSTED_PRICING_SIGNER_KEY_IDS_JSON`
  - JSON array of allowed `keyId` strings
  - when set and non-empty, only signatures by these key IDs are treated as trusted (even if additional keys are present in `SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON`)

Do not overload governance roots: pricing signer trust is a separate trust set with a distinct purpose and blast radius.

## Buyer decision signer keys (required to verify SettlementDecisionReport)

Buyer approval/hold receipts (`SettlementDecisionReport.v1`) are signed and must be verified under a buyer-controlled trust set.

Verifier input mechanism:

- `SETTLD_TRUSTED_SETTLEMENT_DECISION_SIGNER_KEYS_JSON`
  - JSON object mapping `keyId -> publicKeyPem`
  - required to validate settlement decision report signatures

## Time authorities (required only when needed)

Bundles may include `timestampProof` objects that require a verifier-trusted time authority key.

Verifier input mechanism:

- `SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON`
  - JSON object mapping `keyId -> publicKeyPem`
  - required only when verifying a timestamp proof that must be trusted in strict mode

## Fixture corpus convention

The committed end-to-end fixtures under `test/fixtures/bundles/v1/**` include a `trust.json` file that contains the trusted keys used by tests.

The CLI fixture harness reads that file and injects the corresponding env vars when running `settld-verify` against fixtures.

## Rotation workflow (example)

1. Add the new root key to your trust file (do not remove the old one yet).
2. Roll out the trust file change to CI/verifier environments.
3. Begin signing new governance policy streams with the new root key.
4. Once all verifiers are updated and the old root is no longer needed, remove the old root key from the trust file.

If you remove a trust root key too early, strict verification will fail with trust-related errors (see `ERRORS.md`).
