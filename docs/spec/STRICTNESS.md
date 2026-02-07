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
| trusted governance root keys provided out-of-band | required (fail) | best-effort (warn + continue) |
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
| trusted governance root keys provided out-of-band | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` present | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` version | **must be `GovernancePolicy.v2`** (fail) | allow `GovernancePolicy.v1` (warn + continue) |
| `governance/policy.json` signature (governance root) | required (fail) | not required (no check) |
| `governance/revocations.json` present + signature | required (fail) | not required (no check) |
| `attestation/bundle_head_attestation.json` present + valid | required (fail) | best-effort (warn + continue) |
| `verify/verification_report.json` present + signed | required (fail) | best-effort (warn + continue if missing; verify if present) |

### Invoice bundles (InvoiceBundle.v1)

| Surface | Strict | Non-strict |
|---|---:|---:|
| `manifest.json` present + `manifestHash` correct | required (fail) | required (fail) |
| `manifest.json` file hashes correct | required (fail) | required (fail) |
| trusted governance root keys provided out-of-band | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` present | required (fail) | best-effort (warn + continue) |
| `governance/policy.json` version | **must be `GovernancePolicy.v2`** (fail) | allow `GovernancePolicy.v1` (warn + continue) |
| `governance/policy.json` signature (governance root) | required (fail) | not required (no check) |
| `governance/revocations.json` present + signature | required (fail) | not required (no check) |
| `attestation/bundle_head_attestation.json` present + valid | required (fail) | best-effort (warn + continue) |
| `verify/verification_report.json` present + signed | required (fail) | best-effort (warn + continue if missing; verify if present) |
| `pricing/pricing_matrix_signatures.json` present + valid buyer signature(s) (`PricingMatrixSignatures.v2` required; `PricingMatrixSignatures.v1` legacy accepted only non-strict with `WARN_PRICING_SIGNATURE_V1_BYTES_LEGACY`) | required (fail) | best-effort (warn + continue if missing) |

### Close packs (ClosePack.v1)

| Surface | Strict | Non-strict |
|---|---:|---:|
| ClosePack `manifest.json` present + `manifestHash` correct | required (fail) | required (fail) |
| ClosePack manifest file hashes correct | required (fail) | required (fail) |
| trusted governance root keys provided out-of-band | required (fail) | best-effort (warn + continue) |
| ClosePack governance policy surfaces | required (fail) | best-effort (warn + continue) |
| ClosePack head attestation present + valid | required (fail) | best-effort (warn + continue) |
| ClosePack verification report present + signed | required (fail) | best-effort (warn + continue if missing; verify if present) |
| embedded `payload/invoice_bundle/**` strictly verifies under same posture | required (fail) | required (fail) |
| `evidence/evidence_index.json` present + matches deterministic recomputation | required (fail) | required (fail) |
| SLA evaluation surfaces (`sla/*`) | optional; if present must recompute + match | optional; missing emits `CLOSE_PACK_SLA_SURFACES_MISSING_LENIENT` |
| acceptance evaluation surfaces (`acceptance/*`) | optional; if present must recompute + match | optional; missing emits `CLOSE_PACK_ACCEPTANCE_SURFACES_MISSING_LENIENT` |
