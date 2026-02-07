# SettlementDecisionReport.v1

`SettlementDecisionReport.v1` is a canonical JSON object that records a buyer’s **Approve/Hold** decision for a specific `InvoiceBundle.v1`.

It is intended to be archived alongside the invoice bundle zip and re-verified later **offline** (without access to the hosted service).

## Purpose

- Provide a portable, cryptographically verifiable receipt of a buyer decision.
- Bind the decision to a specific invoice bundle instance (mix-and-match defense).
- Capture the effective hosted verification posture and result summary the decision was made under.

## Core fields

- `schemaVersion = "SettlementDecisionReport.v1"`
- `decision`: `"approve"` or `"hold"`
- `decidedAt`: ISO timestamp of the decision action
- `invoiceBundle` (binding target):
  - `manifestHash`: invoice bundle manifest hash
  - `headAttestationHash`: invoice bundle head attestation hash
- `policy`: effective policy snapshot (requiredMode / failOnWarnings / allowAmberApprovals / requiredPricingMatrixSignerKeyIds / etc.)
- `verification`: summary slice of the hosted verification output (stable codes)
- `tool`: `{ name, version, commit }` (best-effort provenance for the hosted verifier build)
- `actor` (optional): service-level claims about who clicked approve/hold (e.g., email, auth method)

## Report hash + signature

- `reportHash` is computed over the canonical JSON object with `reportHash`, `signature`, `signerKeyId`, and `signedAt` removed.
- If the report is signed, it includes:
  - `signature` (base64 Ed25519 signature)
  - `signerKeyId`
  - `signedAt`

Signature algorithm:

- The signed message is the bytes of the 32-byte sha256 digest (`reportHash` hex decoded).
- Algorithm: Ed25519.

## Trust anchors (out-of-band)

To verify a settlement decision report, the verifier needs trusted buyer decision signer public keys out-of-band.

See `TRUST_ANCHORS.md`.

