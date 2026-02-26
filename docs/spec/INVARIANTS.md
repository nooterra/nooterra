# Protocol + Verifier Invariants (v1)

This is the **invariants checklist** for the Nooterra artifact protocol and verifier.

Each invariant maps:

- what is promised,
- where it is specified,
- where it is enforced,
- and what evidence exists (tests / fixtures / conformance).

## Invariants

### INV-001 (P1) — Canonical JSON is RFC 8785 (JCS)

- **Statement**: All JSON objects that are hashed or signed MUST be canonicalized using RFC 8785 (JCS), and hashes are computed over UTF-8 bytes of the canonical JSON string.
- **Specified**: `CANONICAL_JSON.md`
- **Enforced**:
  - Verifier canonicalization used for hashing/signing: `packages/artifact-verify/src/job-proof-bundle.js:186`–`190`
- **Evidence**:
  - Tests: `test/protocol-vectors.test.js`, `test/protocol-vectors.test.js` (torture cases)
- **Failure codes**: varies by caller (hash/signature mismatch errors)

### INV-002 (P1) — Hash algorithm is SHA-256, hex lowercase

- **Statement**: SHA-256 is the only hashing algorithm used for protocol commitments in v1, encoded as lowercase hex.
- **Specified**: `CRYPTOGRAPHY.md`
- **Enforced**:
  - Verifier: `packages/artifact-verify/src/crypto.js:1`
  - Streaming file hashing: `packages/artifact-verify/src/hash-file.js`
- **Evidence**:
  - Fixtures + conformance (manifest tamper cases)

### INV-003 (P0) — Manifests exclude `verify/**` (no circular hashing)

- **Statement**: Bundle manifests MUST exclude `verify/**` from their file listing to avoid circular hashing of derived verification outputs.
- **Specified**: `ProofBundleManifest.v1.md`, `FinancePackBundleManifest.v1.md`
- **Enforced**:
  - Bundlers write manifests with excludes: `src/core/proof-bundle.js:357`, `src/core/finance-pack-bundle.js:285`
  - Fixture determinism gate: `test/verify-fixtures-generator-determinism.test.js`
- **Failure codes**: none (contractual; enforced by generation + tests)

### INV-004 (P0) — Manifest file hashes are verified against raw file bytes

- **Statement**: For every entry in `manifest.json.files[]`, the verifier MUST hash the referenced file as raw bytes and compare to the manifest `sha256`.
- **Specified**: `ProofBundleManifest.v1.md`, `FinancePackBundleManifest.v1.md`, `REFERENCE_VERIFIER_BEHAVIOR.md`
- **Enforced**:
  - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:39`
  - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:40`
- **Evidence**:
  - Conformance: `*_strict_fail_manifest_tamper` cases in `conformance/v1/cases.json`
- **Failure codes**:
  - `sha256 mismatch`
  - `missing file`

### INV-005 (P1) — VerificationReport.v1 binds to `manifestHash`

- **Statement**: A strict `VerificationReport.v1` MUST include a subject `manifestHash` equal to the computed bundle manifest hash.
- **Specified**: `VerificationReport.v1.md`
- **Enforced**:
  - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:167`–`174`
  - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:362`–`368`
- **Evidence**:
  - Fixture suite covers mismatch cases (strict fail)
- **Failure codes**:
  - `verification report subject.manifestHash mismatch`

### INV-006 (P1) — VerificationReport.v1 binds to bundle head attestation (`attestationHash`)

- **Statement**: In strict mode for proof bundles, `VerificationReport.v1.bundleHeadAttestation.attestationHash` MUST match the computed head attestation hash.
- **Specified**: `VerificationReport.v1.md`, `BundleHeadAttestation.v1.md`
- **Enforced**:
  - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:176`–`184`
- **Evidence**:
  - Fixture suite includes binding mismatch cases (strict fail)
- **Failure codes**:
  - `verification report bundleHeadAttestation.attestationHash mismatch`

### INV-007 (P0) — Strict mode requires a signed `verify/verification_report.json` (Proof + FinancePack)

- **Statement**: In strict mode, required verification surfaces MUST exist and be valid, including a signed `verify/verification_report.json` for bundles where the strict profile requires it.
- **Specified**: `STRICTNESS.md`, `VerificationReport.v1.md`
- **Enforced**:
  - Proof/FinancePack verifier paths (strict requires): verifier bundle implementations.
- **Evidence**:
  - Conformance: `financepack_strict_fail_missing_verification_report`
  - Fixture tests: `test/verify-fixture-bundles.test.js`
- **Failure codes**:
  - `strict requires verify/verification_report.json`

### INV-008 (P0) — Non-strict may accept missing report but MUST warn (stable code)

- **Statement**: In non-strict mode, missing `verify/verification_report.json` may be accepted, but MUST emit `VERIFICATION_REPORT_MISSING_LENIENT`.
- **Specified**: `STRICTNESS.md`, `WARNINGS.md`
- **Enforced**:
  - Verifier bundle implementations emit warnings.
- **Evidence**:
  - Conformance: `jobproof_nonstrict_pass_missing_verification_report`, `monthproof_nonstrict_pass_missing_verification_report`
- **Warning codes**:
  - `VERIFICATION_REPORT_MISSING_LENIENT`

### INV-009 (P0) — Strict mode requires trusted governance roots (out-of-band trust)

- **Statement**: In strict mode, if verification requires governance-root signatures, the verifier MUST require trusted governance root keys via `NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON`.
- **Specified**: `TRUST_ANCHORS.md`
- **Enforced**:
  - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js` (strict trust check)
  - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js` (strict trust check)
- **Evidence**:
  - Conformance: `financepack_strict_fail_trust_roots_missing`, `financepack_strict_fail_trust_roots_wrong`
- **Failure codes**:
  - `strict requires trusted governance root keys`
  - `governance policy signerKeyId not trusted`

### INV-010 (P0) — Manifest path validation is mandatory and precedes hash binding

- **Statement**: A verifier MUST validate manifest entry paths (bundle-relative, no traversal, no escape, no duplicates) before reporting `manifestHash mismatch` or other downstream bindings.
- **Specified**: `REFERENCE_VERIFIER_BEHAVIOR.md`
- **Enforced**:
  - Path + duplicate validation: `packages/artifact-verify/src/bundle-path.js:13`–`53`
  - Pre-validation order:
    - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:1247`–`1250`
    - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:460`–`463`
- **Evidence**:
  - Conformance: `security_manifest_path_traversal`, `security_manifest_duplicate_paths`
- **Failure codes**:
  - `MANIFEST_PATH_INVALID`
  - `MANIFEST_DUPLICATE_PATH`

### INV-011 (P0) — Symlinks are forbidden for manifest-listed files

- **Statement**: If a manifest-listed path resolves to a symlink, verification MUST fail (strict and non-strict).
- **Specified**: `REFERENCE_VERIFIER_BEHAVIOR.md`
- **Enforced**:
  - Proof bundles: `packages/artifact-verify/src/job-proof-bundle.js:75`
  - FinancePack: `packages/artifact-verify/src/finance-pack-bundle.js:71`
- **Evidence**:
  - Conformance: `security_bundle_symlink_outside`
- **Failure codes**:
  - `MANIFEST_SYMLINK_FORBIDDEN`

### INV-012 (P0) — `--fail-on-warnings` converts warnings into a deterministic failure

- **Statement**: When `--fail-on-warnings` is set, any warnings MUST cause the CLI output to include `FAIL_ON_WARNINGS` and exit non-zero.
- **Specified**: `VerifyCliOutput.v1.md`
- **Enforced**:
  - CLI: `packages/artifact-verify/bin/nooterra-verify.js:112`–`121`
- **Evidence**:
  - Conformance: `financepack_strict_fail_on_warnings_tool_version_unknown`
- **Failure codes**:
  - `FAIL_ON_WARNINGS`

### INV-013 (P1) — Verify CLI output is stable and machine-ingestible (`VerifyCliOutput.v1`)

- **Statement**: `nooterra-verify --format json` MUST emit a `VerifyCliOutput.v1` object with stable top-level fields and deterministic ordering of `errors[]` and `warnings[]`.
- **Specified**: `VerifyCliOutput.v1.md`
- **Enforced**:
  - CLI normalization: `packages/artifact-verify/bin/nooterra-verify.js:83`–`122`
- **Evidence**:
  - Tests: `test/verify-cli-determinism.test.js`

### INV-016 (P1) — Verify CLI `--explain` is deterministic and secret-free

- **Statement**: `nooterra-verify --explain` MUST emit deterministic diagnostics to stderr and MUST NOT leak secrets (tokens, headers, private keys). `--format json` stdout MUST remain valid and deterministic.
- **Specified**: `VerifyCliOutput.v1.md` (tooling contract)
- **Enforced**:
  - CLI explain writer: `packages/artifact-verify/bin/nooterra-verify.js:228`
- **Evidence**:
  - Tests: `test/explain-snapshots.test.js`

### INV-014 (P0) — Strict mode enforces signer authorization via governance policy

- **Statement**: In strict mode, the verifier MUST enforce that the signer for each governed signature (bundle head attestation, verification report) is authorized by the active governance policy (and is within validity/revocation constraints).
- **Specified**: `GovernancePolicy.v2.md`, `STRICTNESS.md`, `TRUST_ANCHORS.md`
- **Enforced**:
  - Head attestation authorization: `packages/artifact-verify/src/job-proof-bundle.js:1138`–`1151`
  - Verification report authorization (proof bundles): `packages/artifact-verify/src/job-proof-bundle.js:215`–`226`
  - Verification report authorization (FinancePack): `packages/artifact-verify/src/finance-pack-bundle.js:410`–`421`
- **Evidence**:
  - Conformance: `jobproof_strict_fail_unauthorized_signer`, `monthproof_strict_fail_unauthorized_signer`
- **Failure codes**:
  - `attestation signer not authorized`
  - `verification report signer not authorized`

### INV-015 (P1) — Tool provenance unknown emits stable warnings

- **Statement**: When tool version or commit cannot be derived, the verifier MUST emit stable warning codes rather than ad-hoc strings.
- **Specified**: `TOOL_PROVENANCE.md`, `WARNINGS.md`
- **Enforced**:
  - Warning codes: `packages/artifact-verify/src/verification-warnings.js`
- **Evidence**:
  - Conformance: `financepack_strict_fail_on_warnings_tool_version_unknown`

### INV-017 (P0) — Invoice pricing terms are signed (contract-grade PricingMatrix)

- **Statement**: In strict mode for `InvoiceBundle.v1`, verifiers MUST require a pricing terms signature surface (`PricingMatrixSignatures.v2` recommended; `PricingMatrixSignatures.v1` legacy) and MUST validate that it binds to `pricing/pricing_matrix.json` and is signed by at least one trusted key.
- **Specified**: `PricingMatrixSignatures.v2.md`, `PricingMatrixSignatures.v1.md`, `STRICTNESS.md`, `WARNINGS.md`, `TRUST_ANCHORS.md`
- **Enforced**:
  - Node verifier: `packages/artifact-verify/src/invoice-bundle.js` (pricing terms signature enforcement)
  - Python reference verifier: `reference/verifier-py/nooterra-verify-py` (InvoiceBundle pricing signature checks)
- **Evidence**:
  - Conformance: `invoicebundle_strict_fail_missing_pricing_matrix_signature`, `invoicebundle_strict_fail_invalid_pricing_matrix_signature`, `invoicebundle_nonstrict_pass_unsigned_pricing_matrix_warning`
- **Failure codes**:
  - `PRICING_MATRIX_SIGNATURE_MISSING`
  - `PRICING_MATRIX_SIGNATURE_PAYLOAD_MISMATCH`
  - `PRICING_MATRIX_SIGNATURE_INVALID`
- **Warning codes**:
  - `PRICING_MATRIX_UNSIGNED_LENIENT`

### INV-018 (P0) — Manifest paths must not collide on case-insensitive filesystems

- **Statement**: Bundle manifests MUST NOT include file paths that become ambiguous on case-insensitive filesystems (e.g. `A.txt` vs `a.txt`). Verifiers MUST reject such bundles deterministically.
- **Specified**: This invariants checklist (security + portability guarantee).
- **Enforced**:
  - Node verifier prevalidation: `packages/artifact-verify/src/bundle-path.js:29`
  - Python reference verifier prevalidation: `reference/verifier-py/nooterra-verify-py` (manifest entry loop)
- **Evidence**:
  - Conformance: `security_manifest_case_collision` in `conformance/v1/cases.json`
- **Failure codes**:
  - `MANIFEST_PATH_CASE_COLLISION`

### INV-019 (P1) — Entity interaction direction matrix is complete (`4x4 = 16`)

- **Statement**: The protocol interaction matrix for entity types (`agent|human|robot|machine`) MUST remain complete and directional with all `16` pairs allowed in `InteractionDirectionMatrix.v1`.
- **Specified**: `InteractionDirectionMatrix.v1.md`
- **Enforced**:
  - Core invariant helpers: `src/core/interaction-directions.js`
  - Schema lock: `docs/spec/schemas/InteractionDirectionMatrix.v1.schema.json`
- **Evidence**:
  - Tests: `test/interaction-directions.test.js`
  - Golden vectors: `test/fixtures/protocol-vectors/v1.json` (`interactionDirectionMatrix`)

### INV-020 (P0) — Escrow wallet mutations preserve money movement semantics

- **Statement**: Escrow lock/release/refund operations MUST preserve deterministic money semantics:
  - lock moves value `available -> escrowLocked`,
  - release moves value `payer escrowLocked -> payee available`,
  - refund moves value `escrowLocked -> available` on payer wallet.
- **Specified**: `AgentWallet.v1.md`, `AgentRunSettlement.v1.md`, `ESCROW_NETTING_INVARIANTS.md`
- **Enforced**:
  - Escrow lock: `src/core/agent-wallets.js:301`
  - Escrow release: `src/core/agent-wallets.js:321`
  - Escrow refund: `src/core/agent-wallets.js:350`
- **Evidence**:
  - Tests: `test/api-e2e-agent-wallet-settlement.test.js`
- **Failure codes**:
  - `INSUFFICIENT_WALLET_BALANCE`
  - `INSUFFICIENT_ESCROW_BALANCE`

### INV-021 (P0) — Settlement resolution is single-shot and partition-conserving

- **Statement**: `AgentRunSettlement.v1` MUST resolve exactly once from `locked` to `released|refunded`, and terminal partition MUST satisfy `releasedAmountCents + refundedAmountCents = amountCents`.
- **Specified**: `AgentRunSettlement.v1.md`, `ESCROW_NETTING_INVARIANTS.md`
- **Enforced**:
  - Settlement creation in locked state: `src/core/agent-wallets.js:531`
  - Resolution single-shot guard: `src/core/agent-wallets.js:601`
  - Partition equality check: `src/core/agent-wallets.js:616`
- **Evidence**:
  - Tests: `test/api-e2e-agent-wallet-settlement.test.js`
- **Failure codes**:
  - `settlement already resolved`
  - `releasedAmountCents + refundedAmountCents must equal settlement.amountCents`

### INV-022 (P1) — Arbitration artifacts are canonical, schema-bound, and appeal-linkable

- **Statement**: `ArbitrationCase.v1` and `ArbitrationVerdict.v1` artifacts MUST validate against their schemas, preserve deterministic canonical hashing, and expose explicit appeal references.
- **Specified**: `ArbitrationCase.v1.md`, `ArbitrationVerdict.v1.md`, `CANONICAL_JSON.md`
- **Enforced**:
  - Schema contracts: `docs/spec/schemas/ArbitrationCase.v1.schema.json`, `docs/spec/schemas/ArbitrationVerdict.v1.schema.json`
  - Canonical hashing: `src/core/canonical-json.js`
- **Evidence**:
  - Examples: `docs/spec/examples/arbitration_case_v1.example.json`, `docs/spec/examples/arbitration_verdict_v1.example.json`
  - Tests: `test/arbitration-schemas.test.js`

## Producer invariants (tooling contract)

These invariants cover the producer CLI/tooling surface (not bundle protocol object schemas).

### PROD-001 (P0) — Produce CLI JSON output is safe and machine-ingestible

- **Statement**: `nooterra-produce --format json` MUST emit a `ProduceCliOutput.v1` object whose `errors[]`/`warnings[]` are deterministic and MUST NOT embed arbitrary exception strings or secrets.
- **Specified**: `ProduceCliOutput.v1.md`, `PRODUCER_ERRORS.md`
- **Enforced**:
  - Error normalization: `packages/artifact-produce/src/cli/normalize-produce-error.js`
- **Evidence**:
  - Tests: `test/produce-signer-error-taxonomy.test.js`
  - Conformance: `conformance/v1/produce-cases.json` via `conformance/v1/run-produce.mjs`

### PROD-002 (P0) — Remote signer auth missing yields a stable code

- **Statement**: If a remote signer bearer token is required but missing, producer tooling MUST fail with `SIGNER_AUTH_MISSING`.
- **Specified**: `PRODUCER_ERRORS.md`, `REMOTE_SIGNER.md`
- **Evidence**:
  - Conformance: `produce_jobproof_remote_auth_missing`

### PROD-003 (P0) — Remote signer bad JSON yields a stable code

- **Statement**: If a signer command returns invalid JSON, producer tooling MUST fail with `SIGNER_BAD_RESPONSE`.
- **Specified**: `PRODUCER_ERRORS.md`, `REMOTE_SIGNER.md`
- **Evidence**:
  - Conformance: `produce_jobproof_remote_command_bad_json`

### PROD-004 (P0) — Plugin load failures yield stable codes

- **Statement**: If a signer plugin cannot be imported, producer tooling MUST fail with `SIGNER_PLUGIN_LOAD_FAILED`.
- **Specified**: `PRODUCER_ERRORS.md`, `SIGNER_PROVIDER_PLUGIN.md`
- **Evidence**:
  - Conformance: `produce_jobproof_plugin_load_failed`

### PROD-005 (P0) — Plugin-signed JobProof strict-verifies under conformance trust

- **Statement**: Using a valid signer plugin, producer tooling MUST emit a JobProof bundle that strict-verifies under the conformance trust roots.
- **Evidence**:
  - Conformance: `produce_jobproof_plugin_success_strict_verify`

### PROD-006 (P0) — Process-signer JobProof strict-verifies under conformance trust

- **Statement**: Using a remote signer via local process/stdio, producer tooling MUST emit a JobProof bundle that strict-verifies under the conformance trust roots.
- **Evidence**:
  - Conformance: `produce_jobproof_remote_process_success_strict_verify`

### PROD-007 (P1) — Produce CLI `--explain` is deterministic and secret-free

- **Statement**: `nooterra-produce --explain` MUST emit deterministic diagnostics to stderr and MUST NOT leak secrets (bearer tokens, header values, private keys). JSON stdout MUST remain schema-valid and MUST NOT embed arbitrary exception strings.
- **Specified**: `ProduceCliOutput.v1.md`, `PRODUCER_ERRORS.md`
- **Evidence**:
  - Tests: `test/explain-snapshots.test.js`

### PROD-008 (P1) — Remote-only trust init yields a trust file that strict-verifies

- **Statement**: `nooterra-trust init --mode remote-only` MUST be able to write a `trust.json` (no private keys on disk) that strict verification can consume for bundles produced with the corresponding remote signer.
- **Specified**: `TRUST_ANCHORS.md`, `REMOTE_SIGNER.md`
- **Evidence**:
  - Conformance (producer): `produce_trust_remote_only_init_then_remote_sign_strict_verify`

## Release authenticity invariants (tooling contract)

These invariants cover the release authenticity surface (ReleaseIndex + release trust roots), not bundle protocol v1.

### REL-001 (P0) — Release verification passes when signature and artifacts match

- **Statement**: Given a trusted release root key, `nooterra-release verify --format json` MUST accept a release directory when `release_index_v1.json` signatures are valid and every artifact listed matches its recorded `sha256` and `sizeBytes`.
- **Specified**: `ReleaseIndex.v1.md`, `ReleaseTrust.v2.md`, `SUPPLY_CHAIN.md`
- **Evidence**:
  - Conformance (release): `release_pass`

### REL-002 (P0) — Release artifact hash mismatches fail with stable codes

- **Statement**: If any listed artifact’s bytes do not match its recorded `sha256`, release verification MUST fail with `RELEASE_ASSET_HASH_MISMATCH`.
- **Evidence**:
  - Conformance (release): `release_fail_asset_hash_mismatch`

### REL-003 (P0) — Invalid signatures fail with stable codes (no log scraping)

- **Statement**: If the release index signature is invalid, release verification MUST fail with `RELEASE_SIGNATURE_INVALID` (and MUST enforce quorum if configured).
- **Evidence**:
  - Conformance (release): `release_fail_signature_invalid`

### REL-004 (P0) — Release trust is mandatory

- **Statement**: Release authenticity verification MUST be rooted in an explicit release trust file; missing trust MUST fail with `RELEASE_TRUST_MISSING`.
- **Evidence**:
  - Conformance (release): `release_fail_trust_missing`

### REL-005 (P0) — Revoked release signer keys are rejected deterministically

- **Statement**: If a release signing key is revoked at/before the release signatureTime, release verification MUST fail with `RELEASE_SIGNER_REVOKED`.
- **Specified**: `ReleaseTrust.v2.md`
- **Evidence**:
  - Conformance (release): `release_fail_signer_revoked`

### REL-006 (P0) — Release signature quorum is enforced

- **Statement**: If release trust policy requires `minSignatures > 1`, release verification MUST fail with `RELEASE_SIGNATURE_QUORUM_NOT_SATISFIED` unless quorum is satisfied by trusted signatures.
- **Specified**: `ReleaseTrust.v2.md`, `ReleaseIndexSignatures.v1.md`
- **Evidence**:
  - Conformance (release): `release_fail_quorum_not_satisfied`

## Warning code checklist (closed set)

Warning codes are a **contract** (stable identifiers). See `WARNINGS.md`.

Source of truth in code: `packages/artifact-verify/src/verification-warnings.js`.

- `VERIFICATION_REPORT_MISSING_LENIENT` — report absent, accepted only in non-strict (see INV-008).
- `GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT` — legacy governance policy accepted only in non-strict.
- `GOVERNANCE_POLICY_MISSING_LENIENT` — governance policy missing, accepted only in non-strict.
- `TOOL_VERSION_UNKNOWN` — tool version could not be derived (see `TOOL_PROVENANCE.md`).
- `TOOL_COMMIT_UNKNOWN` — tool commit could not be derived (see `TOOL_PROVENANCE.md`).
