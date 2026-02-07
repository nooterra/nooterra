# Verify Cloud (Magic Link) — Security Q&A (pilot)

This document is designed to be pasted into common procurement/security portals with minimal edits.

If you need a single attachment, download the **Security & Controls packet** — it includes this Q&A, an architecture one-pager, a data inventory, and checksums.

## Product summary (what is Verify Cloud?)

Verify Cloud accepts a vendor-submitted **Settld bundle** (typically `InvoiceBundle.v1` or `ClosePack.v1`), verifies it deterministically, and exposes:

- a read-only hosted report page (Green/Amber/Red)
- deterministic machine-readable outputs (`VerifyCliOutput.v1`)
- export bundles for audit (audit packet, support bundle)

## Data handling

### What is uploaded?

- A ZIP containing a Settld bundle directory (evidence + protocol metadata + manifest + attestations).

### What is stored?

Storage is filesystem-backed under `MAGIC_LINK_DATA_DIR` (often a PVC mount). Per run, Verify Cloud stores:

- **Bundle ZIP bytes (optional)**: `zips/<token>.zip` (controlled by `TenantSettings.v2.artifactStorage.storeBundleZip`)
- **Hosted verification output** (`VerifyCliOutput.v1`): `verify/<token>.json`
- **Redacted public summary** (what feeds hosted UI / exports): `public/<token>.json`
- **Non-normative PDF summary (optional)** (redacted): `pdf/<token>.pdf` (when invoice claim is present; controlled by `TenantSettings.v2.artifactStorage.storePdf`)
- **Producer receipt** (when present inside the bundle): `receipt/<token>.json`
- **ClosePack evaluation/index surfaces** (when present): `closepack/<token>/...`
- **Webhook delivery records** (optional, no secrets): `webhooks/{attempts,record}/<token>_*.json`
- **Minimal immutable run record** (metadata-only, for support/accounting): `runs/<tenant>/<token>.json`

Verify Cloud does **not** separately parse and persist raw evidence file contents outside of the uploaded bundle ZIP bytes (other than the allowlisted, redacted “render model” fields used for UI/PDF/CSV/support exports).

### Retention (defaults + enforcement)

- Default retention: `TenantSettings.v2.retentionDays` (default `30` days).
- Optional per-vendor / per-contract overrides: `TenantSettings.v2.vendorPolicies[*].retentionDays`, `TenantSettings.v2.contractPolicies[*].retentionDays`.
- Enforcement:
  - a background maintenance sweeper deletes retained artifacts (default daily), and
  - uploads opportunistically trigger a sweep before quota checks.

After retention, heavy artifacts (bundle ZIP, verify JSON, PDFs, cached exports, webhook records) are deleted and downloads return `410 retained`. The metadata-only run record remains for support/accounting.

## Security controls

### Authentication models

- **Admin API access**: `x-api-key` header (set `MAGIC_LINK_API_KEY`).
- **Vendor ingest**: vendor-scoped ingest keys (`Authorization: Bearer <ingestKey>`) with upload-only capability.
- **Buyer access (optional)**: email OTP login restricted to allowlisted domains (`TenantSettings.v2.buyerAuthEmailDomains`) and per-email roles (`TenantSettings.v2.buyerUserRoles`).
- **Decision capture (optional)**: approve/hold can be gated by OTP (`TenantSettings.v2.decisionAuthEmailDomains`).

### RBAC roles (buyer)

- `viewer`: view inbox and exports
- `approver`: export CSV/audit packet, approve/hold
- `admin`: settings, onboarding packs, support bundle, security packet

### Audit logging

Verify Cloud appends JSONL audit records for:

- tenant settings changes
- ingest key creation/revocation
- buyer login events (when enabled)
- settlement decision capture (approve/hold)

Exports:

- Security & Controls packet (monthly)
- Audit packet (monthly; deterministic)
- Optional archival export sink (S3-compatible): push monthly audit packet ZIP + CSV (tenant-configurable)
- Support bundle (time-bounded; redacted settings + metadata-first)

### Token security (hosted report links)

- Token format: `ml_` + 24 random bytes (192-bit entropy).
- Token TTL: configurable via `MAGIC_LINK_TOKEN_TTL_SECONDS` (default 7 days).
- Tokens are revocable via the admin API.

### Rate limiting and budgets

Verify Cloud enforces:

- upload size bound (`MAGIC_LINK_MAX_UPLOAD_BYTES`, default 50 MiB)
- tenant + IP rate limiting (`TenantSettings.v2.rateLimits.*`; default `uploadsPerHour=100`, `verificationViewsPerHour=1000`)
- verification timeout (`MAGIC_LINK_VERIFY_TIMEOUT_MS`, default 60s)
- concurrency caps (`MAGIC_LINK_MAX_CONCURRENT_JOBS`, `MAGIC_LINK_MAX_CONCURRENT_JOBS_PER_TENANT`)
- queued verify workers with retries + dead-letter accounting (`MAGIC_LINK_VERIFY_QUEUE_*`)
- hostile ZIP extraction budgets (entry count, path length, per-file bytes, total bytes, compression ratio)

### Secrets handling

- Tenant settings secrets (webhook secret, delegated signer bearer token, etc.) are encrypted at rest when `MAGIC_LINK_SETTINGS_KEY_HEX` is configured (AES-256-GCM).
- Support exports redact secrets by default (e.g. webhook secret material is removed).

## Threat model (short)

Verify Cloud is designed to resist:

- hostile ZIP attacks (zip-slip traversal, symlinks, duplicates/overwrite, encrypted entries, zip bombs)
- resource exhaustion (huge uploads, decompression bombs, long-running verification)
- HTML injection / XSS in rendered fields
- token guessing / link leakage

Mitigations are summarized in the exported **Security & Controls packet** along with the exact budgets/defaults in effect for that deployment.

## Cryptography / verification integrity

- Bundles are verifiable offline: download the bundle ZIP and run `settld-verify` under buyer-controlled trust anchors.
- Trust anchors are supplied out-of-band by the buyer (governance roots, pricing signer keys). Hosted verification can run in `strict` or `compat` depending on trust configuration/policy.
- Cryptographic primitives: SHA-256 hashes and Ed25519 signatures; canonical JSON is used where required for stable hashing.

## Infrastructure expectations

- Verify Cloud is intended to run behind TLS termination (ingress/load balancer). The service itself is HTTP-only by default.
- Encryption at rest is provided by your underlying storage layer (PVC/disk + cloud/KMS configuration).

## Compliance posture

- Verify Cloud is not currently SOC 2 audited.
- It is designed with controls that map well to SOC 2 expectations (authn/authz, audit logging, retention enforcement, secure defaults, and exportability for audit).

## Incident response / vulnerability reporting

- Security issues / vulnerability reports: email `aiden@settld.work` (private disclosure).
- Operational support: see `docs/SUPPORT.md` and `docs/ONCALL_PLAYBOOK.md`.

## Configuration knobs (most commonly requested)

- Environment:
  - `MAGIC_LINK_API_KEY` — admin access
  - `MAGIC_LINK_SETTINGS_KEY_HEX` — encrypt secrets at rest (tenant settings)
  - `MAGIC_LINK_DATA_DIR` — storage location (mount point)
  - `MAGIC_LINK_TOKEN_TTL_SECONDS` — report link TTL
  - `MAGIC_LINK_MAX_UPLOAD_BYTES` — upload cap
  - `MAGIC_LINK_VERIFY_TIMEOUT_MS` — verification timeout
  - `MAGIC_LINK_RATE_LIMIT_UPLOADS_PER_HOUR` — default per-tenant upload limit (overrideable per tenant)
  - `MAGIC_LINK_MAX_CONCURRENT_JOBS`, `MAGIC_LINK_MAX_CONCURRENT_JOBS_PER_TENANT` — concurrency caps
  - `MAGIC_LINK_VERIFY_QUEUE_WORKERS`, `MAGIC_LINK_VERIFY_QUEUE_MAX_ATTEMPTS`, `MAGIC_LINK_VERIFY_QUEUE_RETRY_BACKOFF_MS` — verify queue worker behavior
  - `MAGIC_LINK_RUN_STORE_MODE`, `MAGIC_LINK_RUN_STORE_DATABASE_URL` — run metadata control-plane store mode (`fs|dual|db`)
  - `MAGIC_LINK_MAINTENANCE_INTERVAL_SECONDS` — retention sweep interval (maintenance runner)
- Tenant settings (API):
  - `retentionDays`, `vendorPolicies[*].retentionDays`, `contractPolicies[*].retentionDays`
  - `artifactStorage.storeBundleZip`, `artifactStorage.storePdf`, `artifactStorage.precomputeMonthlyAuditPackets`
  - `archiveExportSink` (S3 archival export sink)
  - `rateLimits` (per-tenant/per-IP windows for upload/view/decision/OTP endpoints)
  - `buyerNotifications` (buyer recipient + delivery mode settings)
  - `buyerAuthEmailDomains`, `buyerUserRoles`
  - `decisionAuthEmailDomains`
  - `webhooks[*]` (with secrets encrypted-at-rest when settings key is configured)
