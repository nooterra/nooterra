# Adoption checklist (design partner ready)

Use this as an operational checklist to adopt Settld verification in CI with audit-grade evidence retention.

## Verification posture

- Decide strict vs non-strict (`docs/spec/STRICTNESS.md`).
- Decide whether warnings gate builds (`--fail-on-warnings`, `docs/spec/WARNINGS.md`).
- Decide required verification outputs to archive:
  - Recommended: archive `VerifyCliOutput.v1` JSON + the bundle itself.

## Trust anchors

- Define who owns governance root keys (generation, storage, rotation).
- Define how trust anchors are distributed to CI (secret store, repo file, env injection).
- Define update process and emergency rotation response.

See `docs/spec/TRUST_ANCHORS.md` and `docs/spec/TOOL_PROVENANCE.md`.

## Key management + governance operations

- Who is authorized to sign:
  - bundle head attestations
  - verification reports
- Rotation and revocation procedures (who triggers, how fast, how communicated).
- Decide whether timestamp proofs are required for historical acceptance.

See `docs/spec/GovernancePolicy.v2.md` and `docs/spec/RevocationList.v1.md`.

## Storage + retention

- Where bundles live (artifact store) and retention period.
- Whether verification happens on:
  - the original produced bundle, or
  - a downloaded bundle copy (must remain byte-identical).
- Who can access archived bundles and verification receipts.

## Release pinning + upgrades

- Pin verifier version (SemVer) for CI stability.
- Define upgrade cadence and rollback plan.

See `docs/spec/VERSIONING.md` and `docs/RELEASING.md`.

