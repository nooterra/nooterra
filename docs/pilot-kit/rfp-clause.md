# Draft RFP clause (evidence-backed invoices)

This clause is intended to be copy/pasted and then tuned to your policy (strict vs amber, evidence types, SLA/acceptance criteria, etc.).

## Verifiable invoice artifacts

Vendor MUST provide an evidence-backed invoice artifact for each billing period that is independently verifiable without access to vendor systems.

The artifact MUST be one of:

- `InvoiceBundle.v1` (invoice claim + metering + pricing terms + evidence references), or
- `ClosePack.v1` (invoice claim + metering + pricing terms + evidence references + optional SLA/acceptance evaluation surfaces).

The artifact MUST:

- be an archived bundle (ZIP or directory) containing payload evidence and protocol metadata
- include a manifest committing (via hashes) to the file set (excluding verifier outputs to avoid circular hashing)
- include attestations and signatures binding verification receipts to the manifest hash and bundle head attestation hash
- include buyer-signed pricing terms (e.g. `PricingMatrixSignatures.v2` referencing a canonical pricing matrix hash)
- support strict verification under explicit buyer-supplied governance trust anchors (provided out-of-band)

## Payment eligibility

Buyer MAY require that an invoice is eligible for payment only when:

- verification is **strict** and **passes** with **no errors**, and
- warnings (Amber) are either:
  - disallowed (auto-hold), or
  - allowed only under an explicit buyer policy, with manual review/audit trail.

## Deliverables and auditability

Vendor MUST provide, per invoice:

- the bundle ZIP bytes (for archiving)
- deterministic verifier output (`VerifyCliOutput.v1`) and any embedded producer receipt (when present)

Vendor SHOULD provide:

- a hosted view-only verification link for buyer review
- an “audit packet” export (bundle ZIP + hosted verification JSON + receipt surfaces + non-normative summary PDF + decision record, where applicable)

## Key lifecycle / rotation

Buyer MUST be able to rotate vendor ingest keys without downtime.

