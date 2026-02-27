# Verify Cloud (Magic Link) — Architecture one-pager

This document describes the hosted verification service used in pilots (“Verify Cloud”, implemented by the Magic Link service).

## Data flow (high level)

1. Vendor uploads a Nooterra bundle ZIP (e.g. `InvoiceBundle.v1` / `ClosePack.v1`) using a vendor-scoped ingest key.
2. Verify Cloud stores the ZIP and runs deterministic verification in a budgeted worker.
3. Verify Cloud writes deterministic outputs + a redacted render model.
4. Buyer views a hosted report link and/or downloads exports (audit packet, CSV, support bundle).
5. (Optional) webhooks deliver verification status events.

## Components

- **HTTP handlers**
  - Vendor ingest: `POST /v1/ingest/:tenantId` (Bearer ingest key)
  - Admin upload: `POST /v1/upload` (admin `x-api-key`)
  - Hosted report/downloads: `GET /r/:token` and `GET /r/:token/<artifact>`
  - Exports: audit packet, support bundle, security packet, CSV
- **Verification worker**
  - Safe unzip with explicit budgets (rejects zip-slip/symlinks/duplicates/encrypted entries/zip bombs)
  - Deterministic verification producing `VerifyCliOutput.v1`
- **Storage (filesystem under `MAGIC_LINK_DATA_DIR`)**
  - Run blobs: bundle zip, verifier output, redacted summaries, PDFs, receipts, ClosePack surfaces
  - Minimal immutable run record: `runs/<tenant>/<token>.json` (metadata-only)
  - Audit/usage logs (JSONL) for accounting and operations
- **Maintenance**
  - Retention sweeper deletes heavy artifacts after effective retention windows

## Trust and integrity model

- Buyers supply governance trust roots and pricing signer keys out-of-band.
- Verification can run in strict or compat mode depending on policy and configured trust.
- Offline verifiability: the buyer can archive the bundle ZIP and deterministically re-verify it later without access to vendor systems.

## Access control model

- Admin API: `x-api-key` (`MAGIC_LINK_API_KEY`)
- Vendor uploads: ingest keys (upload-only)
- Buyer sessions (optional): email OTP allowlist + RBAC roles (`viewer|approver|admin`)
- Decision capture (optional): email OTP gating for approve/hold

## Operational exports

- **Audit packet**: archive-friendly, deterministic
- **Support bundle**: time-bounded; metadata-first; redacted settings snapshot; no raw bundles by default
- **Security & controls packet**: threat model + budgets + retention/redaction manifests + checksums

