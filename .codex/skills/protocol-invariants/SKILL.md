---
name: protocol-invariants
description: Enforce Settld artifact protocol invariants when changing bundlers/verifiers/spec (manifests exclude verify/**, VerificationReport binds to BundleHeadAttestation, strict vs non-strict contract, governance policy enforcement, RFC 8785 canonical JSON). Use when modifying docs/spec, schemas, vectors, fixtures, src/core bundling, or packages/artifact-verify verification.
---

# Protocol invariants (do not break)

## Bundle hashing + circularity

- Keep manifests excluding `verify/**` (to avoid circular hashing).
  - Proof bundles: `docs/spec/ProofBundleManifest.v1.md`
  - Finance packs: `docs/spec/FinancePackBundleManifest.v1.md`
  - Fixture evidence: `test/fixtures/bundles/v1/**/manifest.json`

## Verification receipt binding (mix-and-match defense)

- Keep `verify/verification_report.json` (`VerificationReport.v1`) cryptographically bound to the bundle head attestation.
  - Binding field: `bundleHeadAttestation.attestationHash`
  - Strict verification must fail on mismatch.
  - Key enforcement:
    - `docs/spec/VerificationReport.v1.md`
    - `docs/spec/STRICTNESS.md`

## Strict vs non-strict contract

- In strict mode: missing required surfaces are hard failures.
- In non-strict mode: missing/legacy surfaces are warnings with stable `code`s.
  - Contract: `docs/spec/STRICTNESS.md`
  - Warning codes: `docs/spec/WARNINGS.md`

## Governance (authorization is explicit, versioned, enforced)

- Bundles must carry `governance/policy.json` and (in strict) require `GovernancePolicy.v2` + trusted governance roots.
  - Contract: `docs/spec/GovernancePolicy.v2.md`
  - Schema: `docs/spec/schemas/GovernancePolicy.v2.schema.json`

## Canonical JSON (hash/sign must be language-independent)

- Canonicalization is RFC 8785 (JCS). Do not accept ambiguous JSON number forms.
  - Contract: `docs/spec/CANONICAL_JSON.md`
  - Golden torture cases: `test/fixtures/protocol-vectors/v1.json`

## Optional fields rule

- Optional protocol fields must be omitted when absent (not `null`) unless the schema explicitly allows `null`.

## Required lockstep (treat protocol like an API)

When changing protocol-relevant behavior, expect to touch at least:

- `docs/spec/*.md` (human contract)
- `docs/spec/schemas/*.schema.json` (machine contract)
- `test/fixtures/protocol-vectors/v1.json` (golden meaning)
- `test/fixtures/bundles/v1/**` + `test/fixtures/bundles/v1/fixtures.json` (end-to-end conformance)
- tests under `test/` and `packages/artifact-verify/`

## Quick checks

- Run unit + e2e: `npm test`
- Regenerate vectors (if intentional): `node scripts/spec/generate-protocol-vectors.mjs > test/fixtures/protocol-vectors/v1.json`
- Regenerate bundle fixtures (if intentional): `node scripts/fixtures/generate-bundle-fixtures.mjs`

