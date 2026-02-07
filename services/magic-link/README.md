# Magic Link (hosted verifier MVP)

This service provides a minimal “Magic Link” hosted verifier for `InvoiceBundle.v1` (and `ClosePack.v1`) uploads:

- Upload a bundle zip
- Run strict or compat verification server-side (`mode=strict|compat|auto`)
- Serve a view-only HTML report page
- Expose onboarding wizard APIs for SLA templates + tenant-scoped uploads
- Allow downloads of:
  - original bundle zip
  - hosted `VerifyCliOutput.v1` JSON
  - producer receipt (if present in bundle)
  - PDF summary (non-normative)
  - audit packet zip (bundle + outputs)
  - approval closepack zip (`/r/:token/closepack.zip`, once approved)

## Run

Requirements:

- `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON` is required for `mode=strict` (optional for `mode=compat` / `mode=auto`)
- Node.js (repo toolchain)

Example:

```bash
export MAGIC_LINK_HOST=127.0.0.1   # set 0.0.0.0 in prod
export MAGIC_LINK_PORT=8787
export MAGIC_LINK_API_KEY='dev_key'
export MAGIC_LINK_DATA_DIR=/tmp/settld-magic-link
export MAGIC_LINK_VERIFY_TIMEOUT_MS=60000
export MAGIC_LINK_RATE_LIMIT_UPLOADS_PER_HOUR=100
export MAGIC_LINK_VERIFY_QUEUE_WORKERS=2
export MAGIC_LINK_VERIFY_QUEUE_MAX_ATTEMPTS=3
export MAGIC_LINK_VERIFY_QUEUE_RETRY_BACKOFF_MS=250
export MAGIC_LINK_PAYMENT_TRIGGER_RETRY_INTERVAL_MS=2000
export MAGIC_LINK_PAYMENT_TRIGGER_MAX_ATTEMPTS=5
export MAGIC_LINK_PAYMENT_TRIGGER_RETRY_BACKOFF_MS=5000
export MAGIC_LINK_WEBHOOK_MAX_ATTEMPTS=3
export MAGIC_LINK_WEBHOOK_RETRY_BACKOFF_MS=250
export MAGIC_LINK_WEBHOOK_RETRY_INTERVAL_MS=2000
export MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_THRESHOLD=10
export MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_TARGETS='slack,zapier,defaultRelay,internal'
export MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_WEBHOOK_URL='https://ops.example.com/hooks/settld-alerts'
export MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_WEBHOOK_SECRET='whsec_ops_alerts'
export MAGIC_LINK_DEFAULT_EVENT_RELAY_URL='https://relay.example.com/settld-events'
export MAGIC_LINK_DEFAULT_EVENT_RELAY_SECRET='whsec_shared_relay_secret'
export MAGIC_LINK_INTEGRATION_OAUTH_STATE_TTL_SECONDS=900
export MAGIC_LINK_INTEGRATION_OAUTH_HTTP_TIMEOUT_MS=10000
export MAGIC_LINK_SLACK_OAUTH_CLIENT_ID='123456.123456'
export MAGIC_LINK_SLACK_OAUTH_CLIENT_SECRET='slack_client_secret'
export MAGIC_LINK_SLACK_OAUTH_SCOPES='incoming-webhook'
export MAGIC_LINK_ZAPIER_OAUTH_CLIENT_ID='zapier_client_id'
export MAGIC_LINK_ZAPIER_OAUTH_CLIENT_SECRET='zapier_client_secret'
export MAGIC_LINK_ZAPIER_OAUTH_AUTHORIZE_URL='https://example.zapier.app/oauth/authorize'
export MAGIC_LINK_ZAPIER_OAUTH_TOKEN_URL='https://example.zapier.app/oauth/token'
export MAGIC_LINK_ZAPIER_OAUTH_WEBHOOK_FIELD='webhookUrl'
export MAGIC_LINK_BUYER_OTP_DELIVERY_MODE=record   # record|log|smtp
export MAGIC_LINK_DECISION_OTP_DELIVERY_MODE=record # record|log|smtp

# Required for strict verification:
export SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON='{"key_...":"-----BEGIN PUBLIC KEY-----\\n..."}'

node services/magic-link/src/server.js
```

Optional DB-backed run metadata control plane:

```bash
export MAGIC_LINK_RUN_STORE_MODE=dual   # fs|dual|db
export MAGIC_LINK_RUN_STORE_DATABASE_URL='postgres://user:pass@host:5432/db'
# one-time migration (copies existing runs/* metadata into Postgres):
node scripts/magic-link/migrate-run-records-to-db.mjs
```

`GET /v1/inbox` reads run records first (DB/FS per `MAGIC_LINK_RUN_STORE_MODE`) and falls back to legacy index/meta files for older runs.

## OTP delivery (buyer login + decision approvals)

Magic Link can deliver OTP codes in three modes:

- `record` (default): write OTPs to an on-disk outbox under `MAGIC_LINK_DATA_DIR` (dev/testing)
- `log`: log OTP codes to stdout (dev only)
- `smtp`: send OTP codes via SMTP (production)

Env vars:

- `MAGIC_LINK_BUYER_OTP_DELIVERY_MODE=record|log|smtp`
- `MAGIC_LINK_DECISION_OTP_DELIVERY_MODE=record|log|smtp`

SMTP config (required for `smtp` mode):

- `MAGIC_LINK_SMTP_HOST`
- `MAGIC_LINK_SMTP_PORT` (default `587`)
- `MAGIC_LINK_SMTP_SECURE=1|0` (default `0`; set `1` for SMTPS/465)
- `MAGIC_LINK_SMTP_STARTTLS=1|0` (default `1`; ignored when `SECURE=1`)
- `MAGIC_LINK_SMTP_USER`, `MAGIC_LINK_SMTP_PASS` (optional; enables `AUTH PLAIN`)
- `MAGIC_LINK_SMTP_FROM` (required when `MAGIC_LINK_SMTP_HOST` is set)

## Data dir format + upgrades

Magic Link persists state under `MAGIC_LINK_DATA_DIR`. A small format marker is stored at:

- `format.json` (`schemaVersion: MagicLinkDataFormat.v1`)

On startup, Magic Link can initialize/migrate this marker (default: enabled):

- `MAGIC_LINK_MIGRATE_ON_STARTUP=1` (default)

You can also run an explicit check/migrate command without starting the server:

```bash
node services/magic-link/src/storage-cli.js check --data-dir /path/to/data
node services/magic-link/src/storage-cli.js migrate --data-dir /path/to/data
```

## Ops endpoints

- `GET /health` and `GET /healthz` (liveness/readiness + storage format signal)
- `GET /metrics` (Prometheus text format)

Supportability:

- `GET /v1/tenants/:tenant/support-bundle?from=…&to=…` (zip export for debugging without SSH)

Upload:

```bash
curl -sS -X POST \
  -H "x-api-key: dev_key" \
  -H "x-tenant-id: tenant_example" \
  --data-binary @InvoiceBundle.v1.zip \
  "http://localhost:8787/v1/upload?mode=auto"
```

Upload via CLI:

```bash
export MAGIC_LINK_API_KEY='dev_key'
node packages/magic-link-cli/bin/settld-magic-link.js upload InvoiceBundle.v1.zip --url http://localhost:8787 --mode auto --tenant tenant_example
```

Wizard + template APIs:

```bash
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/sla-templates"

curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"templateId":"delivery_standard_v1","overrides":{"metrics":{"targetCompletionMinutes":45}}}' \
  "http://localhost:8787/v1/tenants/tenant_example/sla-templates/render"

curl -sS -X POST -H "x-api-key: dev_key" --data-binary @InvoiceBundle.v1.zip \
  "http://localhost:8787/v1/tenants/tenant_example/upload?mode=auto&vendorId=vendor_a&contractId=contract_1"
```

Self-service tenant bootstrap + onboarding metrics:

```bash
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"name":"Acme Agent Ops","contactEmail":"ops@acme.example","billingEmail":"billing@acme.example"}' \
  "http://localhost:8787/v1/tenants"

curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/<tenantId>/onboarding-metrics"
```

Integrations (self-serve Slack + Zapier):

```bash
# Open browser UI (admin auth required):
http://localhost:8787/v1/tenants/<tenantId>/integrations

# JSON state
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/<tenantId>/integrations/state"

# OAuth click-connect start (browser redirect):
http://localhost:8787/v1/tenants/<tenantId>/integrations/slack/oauth/start
http://localhost:8787/v1/tenants/<tenantId>/integrations/zapier/oauth/start

# OAuth callback routes (provider redirects here):
# /v1/integrations/slack/oauth/callback
# /v1/integrations/zapier/oauth/callback

# Connect Slack incoming webhook
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"webhookUrl":"https://hooks.slack.com/services/T000/B000/XXXXX"}' \
  "http://localhost:8787/v1/tenants/<tenantId>/integrations/slack/connect"

# Connect Zapier catch hook
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"webhookUrl":"https://hooks.zapier.com/hooks/catch/123456/abcdef/"}' \
  "http://localhost:8787/v1/tenants/<tenantId>/integrations/zapier/connect"

# Send a signed test event to a connected integration
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"event":"verification.completed"}' \
  "http://localhost:8787/v1/tenants/<tenantId>/integrations/slack/test-send"
```

Admin revoke:

```bash
curl -sS -X POST \
  -H "x-api-key: dev_key" \
  -H "content-type: application/json" \
  --data '{"token":"ml_...","reason":"optional"}' \
  http://localhost:8787/v1/revoke
```

## Buyer inbox + vendor ingest

List runs (filters: `status`, `vendorId`, `contractId`, `from`, `to`, `limit`):

```bash
curl -sS \
  -H "x-api-key: dev_key" \
  -H "x-tenant-id: tenant_example" \
  "http://localhost:8787/v1/inbox?status=green"
```

Create a vendor-scoped ingest key (upload-only):

```bash
curl -sS -X POST \
  -H "x-api-key: dev_key" \
  http://localhost:8787/v1/tenants/tenant_example/vendors/vendor_a/ingest-keys
```

Vendor upload using the ingest key (stamps `vendorId` from the key):

```bash
curl -sS -X POST \
  -H "authorization: Bearer igk_..." \
  --data-binary @InvoiceBundle.v1.zip \
  "http://localhost:8787/v1/ingest/tenant_example?mode=auto&contractId=contract_1"
```

Monthly exports:

```bash
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/export.csv?month=2026-02"

curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/audit-packet?month=2026-02" \
  --output audit-packet.zip
```

Tenant analytics + trust graph:

```bash
# browser dashboard (tenant analytics + trust graph + snapshot diff):
http://localhost:8787/v1/tenants/tenant_example/analytics/dashboard

# analytics report: trends + top vendors/contracts + warning/error code distribution
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/analytics?month=2026-02&bucket=day&limit=20"

# trust graph: buyer→vendor and vendor→contract trust edges for the selected month
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/trust-graph?month=2026-02&minRuns=1&maxEdges=200"

# save a trust graph snapshot for a month
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"month":"2026-02","minRuns":1,"maxEdges":200}' \
  "http://localhost:8787/v1/tenants/tenant_example/trust-graph/snapshots"

# list saved trust graph snapshots
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/trust-graph/snapshots?limit=50"

# diff trust graph between two months (uses snapshots when present, otherwise builds on demand)
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/trust-graph/diff?baseMonth=2026-01&compareMonth=2026-02&limit=50"
```

Webhook events:

- `verification.completed`
- `verification.failed`
- `decision.approved`
- `decision.held`

Operational defaults:

- New tenants auto-attach a default relay webhook when `MAGIC_LINK_DEFAULT_EVENT_RELAY_URL` is set.
- Delivery retries/backoff are controlled by `MAGIC_LINK_WEBHOOK_MAX_ATTEMPTS` and `MAGIC_LINK_WEBHOOK_RETRY_BACKOFF_MS`.
- Persistent retry sweeps are controlled by `MAGIC_LINK_WEBHOOK_RETRY_INTERVAL_MS`.
- Dead-letter alerting is controlled by:
  - `MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_THRESHOLD` (`0` disables alerts)
  - `MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_TARGETS` (comma-separated: `slack`, `zapier`, `defaultRelay`, `internal`, or explicit `https://...` URLs)
  - `MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_WEBHOOK_URL` + `MAGIC_LINK_WEBHOOK_DEAD_LETTER_ALERT_WEBHOOK_SECRET` (required for `internal`, and secret required for explicit URL targets)
- Webhook payloads are always HMAC-signed (`x-settld-signature`).
- Slack/Zapier OAuth click-connect is enabled when the corresponding OAuth env vars are configured.

Webhook retry ops (tenant admin):

```bash
# list pending/dead-letter webhook retries (optionally filter by provider=slack|zapier|defaultRelay|webhook)
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/webhook-retries?state=pending&provider=slack"

# process one retry sweep for this tenant immediately
curl -sS -X POST -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/webhook-retries/run-once"

# replay the latest dead-letter webhook retry for a provider
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"provider":"slack","resetAttempts":true,"useCurrentSettings":true}' \
  "http://localhost:8787/v1/tenants/tenant_example/webhook-retries/replay-latest?provider=slack"

# replay a dead-letter webhook retry job back to pending (provider guard is optional)
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"idempotencyKey":"<idempotency_key>","provider":"slack","resetAttempts":true,"useCurrentSettings":true}' \
  "http://localhost:8787/v1/tenants/tenant_example/webhook-retries/<token>/replay?provider=slack"
```

Payment trigger retry ops (tenant admin):

```bash
# list pending/dead-letter payment trigger retries
curl -sS -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/payment-trigger-retries?state=pending"

# process one retry sweep for this tenant immediately
curl -sS -X POST -H "x-api-key: dev_key" \
  "http://localhost:8787/v1/tenants/tenant_example/payment-trigger-retries/run-once"

# replay a dead-letter job back to pending
curl -sS -X POST -H "x-api-key: dev_key" -H "content-type: application/json" \
  --data '{"idempotencyKey":"<decision_report_hash>","resetAttempts":true,"useCurrentSettings":true}' \
  "http://localhost:8787/v1/tenants/tenant_example/payment-trigger-retries/ml_<token>/replay"
```

Tenant-scoped settings now also support:

- `buyerNotifications` (recipient list + `smtp|webhook|record` delivery mode)
- Buyer notifications are idempotent per artifact token, and per upload `runId` when provided.
- `autoDecision` (status-driven automated `approve|hold` policy with system actor stamping)
- `paymentTriggers` (approval delivery to `record|webhook` sinks, idempotent by decision report hash)
- `rateLimits` (`uploadsPerHour`, `verificationViewsPerHour`, `decisionsPerHour`, `otpRequestsPerHour`)
