# Verifier Environment Assumptions + Hardening (v1)

This document describes operational assumptions and recommended hardening when deploying `nooterra-verify`.

## Filesystem assumptions

- The bundle is verified from a local directory (or an extracted zip) whose contents are stable during verification.
- The verifier treats manifest paths as portable `/`-separated bundle-relative paths.
- The verifier refuses symlinks for manifest-listed files and rejects path traversal attempts.
  - Spec: `REFERENCE_VERIFIER_BEHAVIOR.md`

## CI / production recommendations

- **Regulated workflows**: run **strict mode** by default.
  - CLI: `nooterra-verify --strict --format json …`
  - Spec: `STRICTNESS.md`
- **Warnings policy**:
  - If warnings represent “unknown provenance / incomplete guarantees” in your environment, enable `--fail-on-warnings`.
  - CLI: `nooterra-verify --fail-on-warnings …`
  - Spec: `WARNINGS.md`
- **Pin tool versions**:
  - Prefer installing a pinned version of `nooterra-verify` and recording `VerifyCliOutput.v1.tool.{version,commit}` as evidence.
  - Spec: `TOOL_PROVENANCE.md`, `VERSIONING.md`

## Trust anchor distribution (do / don’t)

- DO distribute governance-root public keys out-of-band and pin them (e.g., repo file, immutable artifact, or configuration management).
- DO treat trust anchors as high-integrity inputs (tampering undermines authorization checks).
- DON’T fetch trust roots over unauthenticated channels at verification time.
- Spec: `TRUST_ANCHORS.md`

## Volatility and determinism

- CLI output ordering of `errors[]` and `warnings[]` is deterministic (sorted) to support CI and archival.
- If you need stronger determinism guarantees, archive both:
  - `verify/verification_report.json` inside the bundle (receipt), and
  - `nooterra-verify --format json` output (what your CI observed).

