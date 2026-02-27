# ClosePack.v1

`ClosePack.v1` is a **pre-dispute invoice package**: a single bundle a buyer can archive and later re-verify offline to answer:

- “What was billed?”
- “What work proof was bound to the bill?”
- “What evidence files were referenced?”
- (Optionally) “Did this job meet the SLA?” and “Did it meet acceptance criteria?”

ClosePack is a **bundle kind** with its own `manifest.json`, head attestation, and verification report. It **embeds** an `InvoiceBundle.v1` directory tree.

## On-disk layout (v1)

- `nooterra.json` — header with `type="ClosePack.v1"` and binding inputs (see below).
- `manifest.json` — `ClosePackManifest.v1` (commits to all files except `verify/**`).
- `attestation/bundle_head_attestation.json` — `BundleHeadAttestation.v1` for `kind="ClosePack.v1"`.
- `verify/verification_report.json` — `VerificationReport.v1` bound to this ClosePack’s `manifestHash` and head attestation.
- `payload/invoice_bundle/**` — embedded `InvoiceBundle.v1` (byte-for-byte directory tree copy).
- `evidence/evidence_index.json` — `EvidenceIndex.v1` (required).
- Optional “explainable computations” (portable + recomputable):
  - `sla/sla_definition.json` — `SlaDefinition.v1`
  - `sla/sla_evaluation.json` — `SlaEvaluation.v1`
  - `acceptance/acceptance_criteria.json` — `AcceptanceCriteria.v1`
  - `acceptance/acceptance_evaluation.json` — `AcceptanceEvaluation.v1`

## Hashing + circularity

ClosePack manifests intentionally exclude `verify/**` (same rationale as other bundle kinds) so verification outputs do not create circular hashing.

## Binding inputs (ClosePack header)

`nooterra.json` includes inputs that bind the ClosePack to the embedded Invoice bundle:

- `invoiceBundle.embeddedPath` (constant path within ClosePack, v1)
- `invoiceBundle.manifestHash`
- `invoiceBundle.headAttestationHash`

Verifiers must ensure these match the embedded Invoice bundle instance at `payload/invoice_bundle/**`.

## Strict vs non-strict

- **Strict** mode:
  - ClosePack must be structurally complete and internally consistent.
  - Embedded `InvoiceBundle.v1` must strictly verify.
  - If `sla/*` or `acceptance/*` evaluation surfaces are present, the verifier must recompute them and require exact match.
- **Non-strict** mode:
  - Missing optional `sla/*` and `acceptance/*` surfaces may be accepted with structured warnings (see `WARNINGS.md`).
  - Evidence index is still expected to be present (ClosePack’s core value proposition).

