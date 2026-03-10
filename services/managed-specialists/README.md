# Managed Specialists

First-party managed specialist host for the Phase 1 launch roster.

It serves the initial curated provider set:
- `purchase_runner`
- `booking_concierge`
- `account_admin`

Routes:
- `GET /healthz`
- `GET /nooterra/provider-key`
- `GET /.well-known/provider-publish-jwks.json`
- `GET /.well-known/managed-specialists.json`
- `POST /paid/purchase_runner`
- `POST /paid/booking_concierge`
- `POST /paid/account_admin`

Required environment:

```bash
PORT=9781
NOOTERRA_TENANT_ID=tenant_default
NOOTERRA_PAY_KEYSET_URL=http://127.0.0.1:3000/.well-known/nooterra-keys.json

PROVIDER_PUBLIC_KEY_PEM_FILE=./provider-public.pem
PROVIDER_PRIVATE_KEY_PEM_FILE=./provider-private.pem

NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE=./publish-proof-private.pem
```

Optional delegated browser execution:

```bash
NOOTERRA_AUTH_BASE_URL=http://127.0.0.1:8787
NOOTERRA_OPS_TOKEN=tok_ops
NOOTERRA_MANAGED_SPECIALIST_BROWSER_PROBE=1
```

When browser probe mode is disabled, the service still enforces delegated-account-session bindings and emits deterministic managed specialist execution packets without launching a browser.

Readiness gate:

```bash
npm run -s test:ops:managed-specialists-readiness-gate
```

Hosted dry-run readiness:

```bash
NOOTERRA_MANAGED_SPECIALIST_BASE_URL=https://managed-specialists.example.com \
NOOTERRA_BASE_URL=https://api.nooterra.ai \
NOOTERRA_TENANT_ID=tenant_default \
node scripts/ci/run-managed-specialists-readiness-gate.mjs
```
