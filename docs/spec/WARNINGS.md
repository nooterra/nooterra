# Verification warnings

Warnings are protocol objects, not strings.

## Shape

Each warning is a canonical JSON object:

- `code` (required, closed set)
- `message` (optional, string or null)
- `detail` (optional, any JSON)

Warnings are normalized (deduped + sorted) before being emitted in verification reports.

## Codes (closed set)

- `LEGACY_KEYS_FORMAT_USED`
- `NONSERVER_REVOCATION_NOT_ENFORCED`
- `TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT`
- `GOVERNANCE_POLICY_MISSING_LENIENT`
- `GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT`
- `BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT`
- `MISSING_GOVERNANCE_SNAPSHOT_LENIENT`
- `UNSIGNED_REPORT_LENIENT`
- `VERIFICATION_REPORT_MISSING_LENIENT`
- `CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT`
- `CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT`
- `PRICING_MATRIX_UNSIGNED_LENIENT`
- `WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY`
- `TOOL_VERSION_UNKNOWN`
- `TOOL_COMMIT_UNKNOWN`

Tool provenance derivation rules are documented in `TOOL_PROVENANCE.md`.

## Remediation (operator guidance)

Warnings are non-fatal by default, but they are part of the **public contract**. In regulated workflows you may gate on them with `--fail-on-warnings`.

- `VERIFICATION_REPORT_MISSING_LENIENT`
  - Meaning: bundle is missing `verify/verification_report.json` but non-strict mode allows verify to proceed.
  - Action: regenerate the bundle/receipt with a bundler/verifier that emits signed receipts, or run strict mode to require it.
- `CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT`
  - Meaning: ClosePack bundle is missing portable SLA evaluation surfaces under `sla/*`; non-strict mode allows verify to proceed.
  - Action: regenerate ClosePack with `sla/sla_definition.json` + `sla/sla_evaluation.json` present (or gate workflows on this warning).
- `CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT`
  - Meaning: ClosePack bundle is missing portable acceptance evaluation surfaces under `acceptance/*`; non-strict mode allows verify to proceed.
  - Action: regenerate ClosePack with `acceptance/acceptance_criteria.json` + `acceptance/acceptance_evaluation.json` present (or gate workflows on this warning).
- `PRICING_MATRIX_UNSIGNED_LENIENT`
  - Meaning: invoice bundle lacks a pricing terms signature surface (`pricing/pricing_matrix_signatures.json`) that proves the pricing matrix value was approved by a trusted buyer key; non-strict continues.
  - Action: include a buyer-signed `PricingMatrixSignatures.v2` file (and/or run strict mode to require it), and gate workflows on this warning as needed.
- `WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY`
  - Meaning: invoice bundle used legacy `PricingMatrixSignatures.v1` (raw-bytes binding), which is formatting-fragile; non-strict accepted it for compatibility.
  - Action: migrate to `PricingMatrixSignatures.v2` (canonical JSON binding) and run strict mode to enforce it.
- `UNSIGNED_REPORT_LENIENT`
  - Meaning: a verification report exists but is not signed in a way required for strict assurance.
  - Action: re-run verification with a governed verifier signer and write a signed `verify/verification_report.json`.
- `GOVERNANCE_POLICY_MISSING_LENIENT`
  - Meaning: governance policy file is missing; non-strict continues but governance guarantees are not established.
  - Action: ensure the bundler emits `governance/policy.json` (and related materials); prefer strict mode for audit posture.
- `TRUSTED_GOVERNANCE_ROOT_KEYS_MISSING_LENIENT`
  - Meaning: verifier is running without out-of-band governance trust anchors; non-strict continues but governance signatures are not validated.
  - Action: provide `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON` and run strict mode for audit posture (see `TRUST_ANCHORS.md`).
- `GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT`
  - Meaning: legacy `GovernancePolicy.v1` was accepted (compat mode).
  - Action: upgrade to `GovernancePolicy.v2` and re-bundle; strict mode should require v2.
- `BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT`
  - Meaning: head attestation is missing; non-strict continues but binding guarantees weaken.
  - Action: regenerate bundle with `attestation/bundle_head_attestation.json` present and valid.
- `MISSING_GOVERNANCE_SNAPSHOT_LENIENT`
  - Meaning: governance snapshot(s) were missing and non-strict continued.
  - Action: regenerate bundle including governance snapshot files; strict mode should require them.
- `LEGACY_KEYS_FORMAT_USED`
  - Meaning: verifier encountered a legacy key-format compatibility path.
  - Action: update bundle/key materials to the current key format and re-bundle.
- `NONSERVER_REVOCATION_NOT_ENFORCED`
  - Meaning: verifier could not enforce a revocation decision for a non-server signer under the strict model (compat path).
  - Action: include a trustworthy signing time (`timestampProof`) where required, or adjust governance posture; prefer server-governed signers.
- `TOOL_VERSION_UNKNOWN`
  - Meaning: verifier could not determine its version string.
  - Action: install from a released artifact (npm tarball or pinned version) and ensure `package.json` version is available; consider gating on this warning in CI.
- `TOOL_COMMIT_UNKNOWN`
  - Meaning: verifier could not determine its commit identifier.
  - Action: set the documented commit env source (see `TOOL_PROVENANCE.md`) in your CI/build environment; consider gating on this warning in CI.
