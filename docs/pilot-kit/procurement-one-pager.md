# Verify Cloud (Magic Link) — Procurement one-pager

Verify Cloud is a hosted (or self-hosted) verification layer for **evidence-backed invoices**. Vendors submit a Settld bundle (typically `InvoiceBundle.v1` or `ClosePack.v1`), and buyers get a deterministic verification result plus audit-grade exports.

## What you get

- A read-only “Green / Amber / Red” hosted report link per invoice
- Deterministic verifier output (`VerifyCliOutput.v1`) suitable for archiving and automation
- An **audit packet** export (bundle ZIP + hosted verification JSON + receipt surfaces + non-normative PDF summary + decision record, when present)
- Offline verifiability: download the bundle ZIP and re-verify using `settld-verify` under buyer-controlled trust anchors

## What you need to adopt (pilot)

- Decide trust configuration:
  - governance trust roots (buyer-supplied)
  - pricing signer keys (buyer-supplied)
- Decide enforcement policy:
  - strict vs compat default mode
  - whether Amber (warnings) is acceptable for payment eligibility
- (Optional) enable buyer email OTP + RBAC for inbox and exports

## Integration options

- Vendor upload via ingest key (simple HTTP upload)
- Webhooks for `verification.completed` / `verification.failed`
- CSV export for AP workflows
- Support bundle export for debugging without SSH/screen recordings

## Security posture (high level)

- Hostile ZIP defenses: traversal/zip-slip, symlinks, duplicates, encrypted entries, zip-bomb budgets
- Rate limiting and concurrency budgets (upload + verify)
- Tenant settings secrets encrypted at rest when `MAGIC_LINK_SETTINGS_KEY_HEX` is configured
- Explicit data retention enforcement (heavy artifacts deleted after retention)
- Redaction allowlist for UI/PDF/CSV/support exports (HTML escaped + truncated deterministically)

## One-email security review

Download the **Security & Controls packet** (zip). It includes:

- data inventory + retention behavior summary
- threat model + budgets/defaults
- redaction allowlist manifest
- this procurement one-pager and `security-qa.md`
- file checksums for internal handling/audit

## Offline verification (buyer/auditor)

See `offline-verify.md`.

