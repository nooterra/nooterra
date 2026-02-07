# VerificationReport.v1

`VerificationReport.v1` is a canonical JSON object emitted into `verify/verification_report.json`.

In strict mode, it is **required** and **must be signed**.

## Purpose

- Provide a machine-ingestible record of verification results.
- Bind verification statements to a specific bundle by referencing:
  - `subject.manifestHash`
  - `bundleHeadAttestation.attestationHash` (binding to the head commitment)

## Core fields

- `schemaVersion = "VerificationReport.v1"`
- `profile = "strict"`
- `tool`: `{ name: "settld", version: string | null, commit?: string }`
- `warnings`: array of warning objects (see `WARNINGS.md`)
- `subject`:
  - `type`: bundle kind/type (e.g. `JobProofBundle.v1`, `MonthProofBundle.v1`, `FinancePackBundle.v1`)
  - `manifestHash`: the bundle manifest hash
- `bundleHeadAttestation` (strict-required for bundles that support head attestations):
  - `attestationHash`: must match `attestation/bundle_head_attestation.json` computed hash

## Report hash + signature

- `reportHash` is computed over the canonical JSON object with `reportHash` and `signature` removed.
- If the report is signed, it includes:
  - `signature` (base64)
  - `signerKeyId`
  - `signedAt`

## Timestamp proof (optional)

`timestampProof` (when present) provides a verifier-trusted signing time for revocation/rotation historical acceptance checks. It is computed over the report core **without** `timestampProof` so it can bind to the report payload.

## No circular hashing

`verify/**` is excluded from bundle manifests. The report binds to the bundle by:

- including `subject.manifestHash`
- including `bundleHeadAttestation.attestationHash`
- being signed by a governed server key (in strict mode)

## Tool identity completeness

`tool.commit` is a best-effort build identifier (typically a git commit SHA) intended to answer “what build produced this receipt”.

- If the tool commit cannot be determined, the report MUST include warning code `TOOL_COMMIT_UNKNOWN`.
