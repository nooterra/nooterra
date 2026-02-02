# Strict vs Non-Strict Verification

This document defines the **compatibility contract** for verifier behavior.

## Definitions

- **Strict mode**: missing/invalid protocol surfaces are hard failures.
- **Non-strict mode**: verifier performs best-effort verification and emits **warnings** for legacy or incomplete bundles, but still rejects tampering (e.g., manifest hash mismatch, file hash mismatch).

## Contract matrix (v1 protocol era)

### Proof bundles (JobProofBundle.v1, MonthProofBundle.v1)

| Surface | Strict | Non-strict |
|---|---:|---:|
| `manifest.json` present + `manifestHash` correct | required (fail) | required (fail) |
| `manifest.json` file hashes correct | required (fail) | required (fail) |
| `governance/policy.json` present | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` version | **must be `GovernancePolicy.v2`** (fail) | allow `GovernancePolicy.v1` (warn + continue) |
| `governance/policy.json` signature (governance root) | required (fail) | not required (no check) |
| `governance/revocations.json` present + signature | required (fail) | not required (no check) |
| `attestation/bundle_head_attestation.json` present + valid | required (fail) | best-effort (warn + continue) |
| `verify/verification_report.json` present + signed | required (fail) | best-effort (warn + continue if missing; verify if present) |

### Finance packs (FinancePackBundle.v1)

| Surface | Strict | Non-strict |
|---|---:|---:|
| `manifest.json` present + `manifestHash` correct | required (fail) | required (fail) |
| `manifest.json` file hashes correct | required (fail) | required (fail) |
| `governance/policy.json` present | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` version | **must be `GovernancePolicy.v2`** (fail) | allow `GovernancePolicy.v1` (warn + continue) |
| `governance/policy.json` signature (governance root) | required (fail) | not required (no check) |
| `governance/revocations.json` present + signature | required (fail) | not required (no check) |
| `attestation/bundle_head_attestation.json` present + valid | required (fail) | best-effort (warn + continue) |
| `verify/verification_report.json` present + signed | required (fail) | best-effort (warn + continue if missing; verify if present) |

