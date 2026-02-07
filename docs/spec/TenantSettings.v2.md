# TenantSettings.v2

`TenantSettings.v2` is the **tenant-scoped configuration contract** for Settld Verify Cloud / Magic Link.

It is a backwards-compatible evolution of `TenantSettings.v1` that adds:

- per-tenant artifact storage cost controls (`artifactStorage`)
- tenant-configurable archival export sink (`archiveExportSink`)
- buyer notification delivery config (`buyerNotifications`)
- automatic settlement decision policy controls (`autoDecision`)
- payment trigger delivery controls (`paymentTriggers`)
- tenant-scoped request rate limits (`rateLimits`)

## Schema

See `schemas/TenantSettings.v2.schema.json`.

## Vendor / contract policy controls (service-level)

Unchanged from `TenantSettings.v1`:

- `vendorPolicies` and `contractPolicies` are Verify Cloud enforcement knobs and do **not** change `InvoiceBundle.v1`.

## Artifact storage controls (service-level)

`artifactStorage` controls what Verify Cloud persists under `MAGIC_LINK_DATA_DIR`.

Fields:

- `storeBundleZip` (default `true`): persist `zips/<token>.zip` so a buyer can download the exact bytes that were verified.
- `storePdf` (default `true`): persist `pdf/<token>.pdf` when an invoice claim is present.
- `precomputeMonthlyAuditPackets` (default `false`): allow the service to cache monthly audit packet zips for export sinks (still safe to generate on-demand).

These are service controls (not part of the frozen `InvoiceBundle.v1` protocol).

## Archival export sink (service-level)

`archiveExportSink` configures an optional monthly archival push of:

- monthly audit packet ZIP (`/v1/tenants/:tenant/audit-packet?month=…`)
- monthly CSV export (`/v1/tenants/:tenant/export.csv?month=…`)

Supported sink types:

- `s3`: S3-compatible object storage.

Secrets (e.g. `secretAccessKey`) are encrypted at rest when `MAGIC_LINK_SETTINGS_KEY_HEX` is configured.

## Buyer notifications (service-level)

`buyerNotifications` configures post-verification delivery of buyer links.

Fields:

- `emails`: recipient list (normalized lowercase emails).
- `deliveryMode`: `smtp|webhook|record`.
- `webhookUrl`: required when `deliveryMode=webhook`.
- `webhookSecret`: optional HMAC secret for webhook delivery (encrypted at rest when settings key is configured).

Notification delivery is idempotent per run token.

## Auto-decision policy (service-level)

`autoDecision` configures optional automatic buyer decisions immediately after verification completes.

Fields:

- `enabled`: turn policy automation on/off.
- `approveOnGreen`: auto-approve `green` runs.
- `approveOnAmber`: auto-approve `amber` runs.
- `holdOnRed`: auto-hold `red` runs.
- `templateIds`: optional template allowlist. When set, auto-decision only applies to listed SLA template IDs.
- `actorName` / `actorEmail`: actor identity stamped into `SettlementDecisionReport.v1` for automated decisions.

Automated decisions are best-effort and respect idempotency/lockout (`DECISION_ALREADY_RECORDED`).

## Payment triggers (service-level)

`paymentTriggers` configures optional outbound delivery when an artifact is approved.

Fields:

- `enabled`: enable/disable payment trigger delivery.
- `deliveryMode`: `record|webhook`.
- `webhookUrl`: required when `enabled=true` and `deliveryMode=webhook`.
- `webhookSecret`: optional HMAC signing secret (encrypted at rest when settings key is configured).

Delivery is idempotent per approved decision report hash.

## Tenant rate limits (service-level)

`rateLimits` configures tenant + IP window limits:

- `uploadsPerHour` (default `100`)
- `verificationViewsPerHour` (default `1000`)
- `decisionsPerHour` (default `300`)
- `otpRequestsPerHour` (default `300`)

Exceeded limits return `429` with a `Retry-After` header.
