# Threat Model (v1)

This document describes **in-scope threats**, **mitigations**, and **residual risks** for Nooterra’s bundle protocol and verifier.

It is evidence-backed: each mitigation points to the spec and to executable tests/conformance cases.

## Assets (what we protect)

- **Payload integrity**: bundle payload files are immutable once committed.
- **Bundle completeness**: a verifier can detect selective omission or selective inclusion attacks.
- **Manifest integrity anchor**: `manifestHash` is the primary content commitment.
- **Attestation integrity anchor**: `attestationHash` (bundle head attestation) binds receipts to “this exact bundle.”
- **Signer authorization**: only allowed signers (per governance policy) can sign head attestations and verification reports.
- **Key lifecycle correctness**: rotation/revocation windows are enforced per policy + timeline rules.
- **Trust anchor correctness**: governance roots/time authorities are injected out-of-band and validated.
- **Verifier correctness**: canonicalization + hashing are deterministic and cross-implementation portable.

## Adversaries / threat actors

- **Malicious producer**: creates a bundle intended to mislead downstream users/auditors.
- **Malicious distributor**: tampers with, reorders, or swaps bundle contents in transit/storage.
- **Compromised key**: a signing key is stolen or misused.
- **Malicious verifier environment**: compromised filesystem, dependency, or runtime; attacker attempts to trick hashing/reading.
- **Confused-deputy CI**: pipelines unintentionally verify in a permissive posture or ignore warnings.

## Threats → mitigations (explicit mapping)

### T1: Payload tampering (modify payload files after bundling)

- **Mitigation**: manifest enumerates file hashes; verifier re-hashes and compares.
  - Spec: `ProofBundleManifest.v1.md`, `FinancePackBundleManifest.v1.md`
  - Enforcement:
    - Job/Month proof: `packages/artifact-verify/src/job-proof-bundle.js:39` (manifest file hashing)
    - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:40` (manifest file hashing)
  - Evidence:
    - Conformance: `conformance/v1/cases.json` case `*_strict_fail_manifest_tamper`
    - Fixtures: `test/verify-fixture-bundles.test.js` (CLI matrix strict-fail tamper cases)

### T2: Mix-and-match (swap a valid report/attestation from bundle A onto bundle B)

- **Mitigation**: verification report is bound to both `manifestHash` and `bundleHeadAttestation.attestationHash`.
  - Spec: `VerificationReport.v1.md`, `BundleHeadAttestation.v1.md`
  - Enforcement:
    - Proof report subject manifest binding: `packages/artifact-verify/src/job-proof-bundle.js:148`–`174`
    - Proof report head attestation binding: `packages/artifact-verify/src/job-proof-bundle.js:176`–`184`
  - Evidence:
    - Fixtures: `test/verify-fixture-bundles.test.js` includes strict binding mismatch cases

### T3: Replay (present old but valid artifacts after key revocation / outside validity)

- **Mitigation**: key validity windows + prospective revocation timeline enforcement; optional trustworthy `timestampProof` influences effective signing time.
  - Spec: `RevocationList.v1.md`, `TimestampProof.v1.md`, `GovernancePolicy.v2.md`
  - Enforcement:
    - Head attestation timeline enforcement: `packages/artifact-verify/src/job-proof-bundle.js:1152`–`1163`
    - Verification report timeline enforcement (proof bundles): `packages/artifact-verify/src/job-proof-bundle.js:215`–`233`
  - Evidence:
    - Tests: `test/job-proof-bundle-verify-strict-revocation-timeproof.test.js`

### T4: Downgrade (force non-strict / accept legacy surfaces silently)

- **Mitigation**: strict/non-strict is explicit; non-strict “warn + continue” is coded with stable warning codes; `--fail-on-warnings` can harden non-strict deployments.
  - Spec: `STRICTNESS.md`, `WARNINGS.md`, `VerifyCliOutput.v1.md`
  - Enforcement:
    - Missing report strict vs warn: `docs/spec/STRICTNESS.md` and verifier implementations.
    - CLI warning gating: `packages/artifact-verify/bin/nooterra-verify.js:112`–`121`
  - Evidence:
    - Conformance: `conformance/v1/cases.json` case `financepack_strict_fail_on_warnings_tool_version_unknown`

### T5: Trust-root substitution (attacker provides wrong governance root keys)

- **Mitigation**: verifier requires out-of-band trust roots in strict mode; wrong roots fail signature/trust checks.
  - Spec: `TRUST_ANCHORS.md`
  - Enforcement:
    - Strict requires trusted governance root keys: `packages/artifact-verify/src/job-proof-bundle.js:1338` and `packages/artifact-verify/src/finance-pack-bundle.js:539`
  - Evidence:
    - Conformance: `conformance/v1/cases.json` cases `financepack_strict_fail_trust_roots_missing` and `financepack_strict_fail_trust_roots_wrong`

### T6: Path traversal / symlink exfiltration (verifier reads outside-bundle files)

- **Mitigation**: manifest entry paths are validated as bundle-relative; `..` and absolute paths are rejected; symlinks are forbidden for manifest-listed files.
  - Spec: `REFERENCE_VERIFIER_BEHAVIOR.md`
  - Enforcement:
    - Pre-validate manifest entries before any hash-binding: `packages/artifact-verify/src/bundle-path.js:13`–`53`
    - Enforced pre-validation order:
      - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:1247`–`1250`
      - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:460`–`463`
    - Symlink refusal:
      - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:75`
      - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:71`
  - Evidence:
    - Conformance: `conformance/v1/cases.json` cases `security_manifest_path_traversal`, `security_manifest_duplicate_paths`, `security_bundle_symlink_outside`

### T7: Algorithm confusion / weak algorithms

- **Mitigation**: governance policy carries an allowed-algorithm list; verifier rejects policies that don’t allow required algorithms.
  - Spec: `GovernancePolicy.v2.md`, `CRYPTOGRAPHY.md`
  - Enforcement:
    - Allowed algorithms check: `packages/artifact-verify/src/governance-policy.js:10`–`17` and policy signature verification paths.
  - Evidence:
    - Unit/fixture coverage through strict verification test suite.

## Assumptions (must be true for guarantees to hold)

- The verifier process can read bundle files and trust anchors from a reasonably honest filesystem (see `VERIFIER_ENVIRONMENT.md`).
- Trusted governance roots and (optionally) time authorities are distributed out-of-band and are pinned/managed per `TRUST_ANCHORS.md`.
- Signature private keys are protected; if keys are compromised, the protocol relies on revocation/rotation to limit blast radius.

## Residual risks (explicitly not solved yet)

- **Compromised build pipeline / dependency supply chain**: a malicious verifier build can lie. Mitigation lives in release discipline + SBOM + reproducible builds (outside v1 protocol core).
- **Compromised OS or kernel**: an attacker controlling the runtime can tamper with file reads.
- **UI/operational misuse**: running non-strict without gating warnings may be unacceptable in regulated workflows (see `VERIFIER_ENVIRONMENT.md`).

