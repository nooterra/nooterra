# Verifier Errors (v1)

This document defines the **stable error-code contract** for `nooterra-verify`.

- **Warnings** are documented separately in `WARNINGS.md`.
- In machine output (`VerifyCliOutput.v1`), errors appear in `errors[]` as `{ code, path?, message?, detail? }`.
- **Stability guarantee**: error `code` meanings are stable within protocol v1 unless a deliberate, documented protocol change is made.

## Severity model

- Errors are **fatal**: they indicate verification did not establish required guarantees.
- Some errors may only be reachable in strict mode (because non-strict may downgrade certain missing surfaces into warnings); see `STRICTNESS.md`.

## Core error codes (high-value contract)

These codes are relied on by fixtures, conformance packs, and CI consumers.

- `MANIFEST_PATH_INVALID` — A manifest entry path is unsafe/invalid (absolute/traversal/escape/backslash/colon). Remediation: regenerate bundle; do not accept the bundle as structurally safe. Evidence: conformance security cases.
- `MANIFEST_DUPLICATE_PATH` — Manifest contains duplicate `files[].name`. Remediation: regenerate bundle with unique paths. Evidence: conformance security cases.
- `MANIFEST_PATH_CASE_COLLISION` — Manifest contains file paths that collide under case-insensitive normalization (e.g. `A.txt` vs `a.txt`). Remediation: regenerate bundle with case-unique paths; do not rely on case sensitivity for protocol semantics.
- `MANIFEST_SYMLINK_FORBIDDEN` — A manifest-listed file is a symlink. Remediation: bundle must contain regular files only; remove symlinks and regenerate. Evidence: conformance security cases.

- `sha256 mismatch` — A manifest-listed file hash does not match actual bytes. Remediation: bundle was tampered with or incorrectly generated; regenerate bundle. Evidence: strict-fail tamper fixtures/conformance.
- `missing file` — Manifest references a file that does not exist. Remediation: bundle is incomplete; regenerate bundle. Evidence: strict required file enumeration + file hashing.

- `manifestHash mismatch` — The embedded `manifestHash` does not match the computed manifest hash (canonical JSON). Remediation: bundle is inconsistent/tampered; regenerate bundle.

- `verification report subject.manifestHash mismatch` — Receipt binds to a different manifest than the bundle. Remediation: do not mix receipts across bundles; re-verify/generate receipt for this bundle.
- `verification report bundleHeadAttestation.attestationHash mismatch` — Receipt binds to a different head attestation than the bundle. Remediation: do not mix attestations across bundles; re-verify/generate receipt for this bundle.

- `strict requires trusted governance root keys` — Strict verification requires trust roots but they were not provided. Remediation: provide `NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON` (see `TRUST_ANCHORS.md`). Evidence: conformance trust cases.
- `governance policy signerKeyId not trusted` — Governance policy signature cannot be validated under provided trust roots. Remediation: correct/pin trust roots; verify policy provenance.

- `attestation signer not authorized` — Bundle head attestation signer is not allowed by policy. Remediation: update governance policy or use an authorized signer; regenerate bundle.
- `verification report signer not authorized` — Receipt signer is not allowed by policy. Remediation: update governance policy or use an authorized verifier signer; regenerate receipt.

- `missing verify/verification_report.json` — A required verification receipt is absent. Remediation: (strict) regenerate the bundle/receipt; (non-strict) expect `VERIFICATION_REPORT_MISSING_LENIENT` warning instead of failure.
- `signer keyId not allowed by policy` — The signer key is not allowlisted by governance policy. Remediation: update policy allowlist or sign with an authorized key.
- `SIGNER_REVOKED` — The signer is revoked as-of the effective signing time. Remediation: rotate keys and re-sign; ensure timestampProof is present when verifying historical signatures.
- `SIGNING_TIME_UNPROVABLE` — Verification cannot establish a trustworthy signing time required for a revocation timeline decision. Remediation: include a valid `timestampProof` or adjust policy to not require a trustworthy time for the decision.

- `PRICING_MATRIX_SIGNATURE_MISSING` — Strict verification requires `pricing/pricing_matrix_signatures.json` (`PricingMatrixSignatures.v2` recommended; `PricingMatrixSignatures.v1` legacy) but it is absent from the manifest. Remediation: include buyer-approved pricing signatures (see `PricingMatrixSignatures.v2.md`) or use compat mode with an explicit warning posture.
- `PRICING_MATRIX_SIGNATURE_V1_BYTES_LEGACY_STRICT_REJECTED` — Strict verification rejects legacy `PricingMatrixSignatures.v1` (raw-bytes binding) because it is formatting-fragile and creates operational footguns. Remediation: migrate to `PricingMatrixSignatures.v2` (canonical JSON binding) and re-bundle.
- `PRICING_MATRIX_SIGNATURE_PAYLOAD_MISMATCH` — The pricing matrix signature surface is present, but its declared binding hash does not match the pricing matrix payload (either raw bytes for `PricingMatrixSignatures.v1` or canonical JSON for `PricingMatrixSignatures.v2`). Remediation: regenerate the signature surface from the intended pricing matrix payload and ensure the bundle contains the intended pricing matrix value.
- `PRICING_MATRIX_SIGNATURE_INVALID` — The pricing matrix signature surface is present and hash-bound correctly, but at least one trusted signature failed to verify. Remediation: regenerate signatures using the correct buyer key(s) and ensure verifiers trust the corresponding public keys (see `TRUST_ANCHORS.md`).

- `invoice pricing code unknown` — Metering references a code that has no price in `PricingMatrix.v1`. Remediation: update pricing to cover all metered codes or fix the metering report.
- `invoiceClaim totalCents mismatch` — `InvoiceClaim.v1.totalCents` does not match deterministic recomputation from metering+pricing. Remediation: regenerate the claim from the bound inputs.
- `metering evidenceRef sha256 mismatch` — A metering evidence reference does not match the embedded JobProof manifest’s committed file hash. Remediation: regenerate metering evidence refs and/or re-embed the correct JobProof bundle.
- `closepack evidence_index mismatch` — `EvidenceIndex.v1` does not match deterministic recomputation from the embedded Invoice+JobProof evidence bindings. Remediation: regenerate ClosePack’s `evidence/evidence_index.json` from the embedded inputs; treat mismatch as a tamper/inconsistency.

- `FAIL_ON_WARNINGS` — CLI `--fail-on-warnings` converted warnings into a failure. Remediation: address warnings or remove gating for your posture.

## How to troubleshoot (support loop)

When filing an issue or investigating a pilot failure, capture:

1. `nooterra-verify --about --format json`
2. The full `VerifyCliOutput.v1` JSON (`--format json`)
3. How trust roots were provided (env vars / trust file) and which root keys were intended
4. Installation mode: npm install vs npm tarball vs from source

Key fields in `VerifyCliOutput.v1` that enable diagnosis:

- `errors[].code` — stable machine reason (this doc).
- `errors[].detail` — structured context (expected/actual hashes, missing paths, signer ids).
- `summary.manifestHash` — integrity anchor for “what was verified.”
- `tool.version` / `tool.commit` — provenance for “what did the verifying.”

## Full registry (exhaustive)

The authoritative list of error codes that may be emitted as `VerifyCliOutput.v1.errors[].code` is maintained in:

- `docs/spec/error-codes.v1.txt`

This file is **machine-checked** by tests to prevent accidental drift (see Sprint 13 “v1 freeze” discipline).
