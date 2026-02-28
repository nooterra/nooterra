# Quickstart: First verified agent run with the SDK

Goal: run one end-to-end agent transaction (register identities, append run events, verify `green`, release settlement) using `NooterraClient.firstVerifiedRun(...)`.

## Package-consumer path (recommended)

### 0) Install the SDK package

```sh
npm install nooterra-api-sdk
```

### 1) Set required environment variables

```sh
export NOOTERRA_BASE_URL="https://your-nooterra-api"
export NOOTERRA_TENANT_ID="your_tenant_id"
export NOOTERRA_API_KEY="keyId.secret"
# optional for Magic Link deployments that enforce x-api-key:
# export NOOTERRA_X_API_KEY="your_x_api_key"
```

### 2) Run a first verified transaction directly

Create `first-verified-run.mjs`:

```js
import { NooterraClient } from "nooterra-api-sdk";

const required = ["NOOTERRA_BASE_URL", "NOOTERRA_TENANT_ID", "NOOTERRA_API_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

const client = new NooterraClient({
  baseUrl: process.env.NOOTERRA_BASE_URL,
  tenantId: process.env.NOOTERRA_TENANT_ID,
  apiKey: process.env.NOOTERRA_API_KEY,
  xApiKey: process.env.NOOTERRA_X_API_KEY
});

const result = await client.firstVerifiedRun({
  payeeAgent: { publicKeyPem: "...", owner: { ownerType: "service", ownerId: "svc_a" } },
  payerAgent: { publicKeyPem: "...", owner: { ownerType: "service", ownerId: "svc_b" } },
  payerCredit: { amountCents: 5000 },
  settlement: { amountCents: 1200 },
  run: { taskType: "translation" }
});

const verificationStatus =
  result.verification?.body?.verification?.verificationStatus ??
  result.verification?.body?.verificationStatus ??
  null;

console.log(
  JSON.stringify(
    {
      runId: result.ids?.runId ?? null,
      payeeAgentId: result.ids?.payeeAgentId ?? null,
      payerAgentId: result.ids?.payerAgentId ?? null,
      runStatus: result.runCompleted?.body?.run?.status ?? null,
      verificationStatus,
      settlementStatus: result.settlement?.body?.settlement?.status ?? null
    },
    null,
    2
  )
);
```

Run it:

```sh
node first-verified-run.mjs
```

Expected output:

```json
{
  "runId": "run_sdk_...",
  "payeeAgentId": "agt_payee_...",
  "payerAgentId": "agt_payer_...",
  "runStatus": "completed",
  "verificationStatus": "green",
  "settlementStatus": "released"
}
```

## Local/dev path (repo helpers)

Use this path when running against a local checkout of this repo.

### 0) Install repo deps

```sh
npm ci
```

### 1) Fast path with helper scripts

```sh
npm run dev:env:init
# edit .env.dev with your DATABASE_URL once
```

Start API:

```sh
npm run dev:start
```

In another shell:

```sh
source scripts/dev/env.sh
npm run dev:sdk:first-run
```

Run the full billing + dispute + arbitration doctor flow:

```sh
source scripts/dev/env.sh
npm run dev:billing:doctor
```

Optional: make `sdk:first-run` create a disputable settlement window:

```sh
NOOTERRA_SDK_DISPUTE_WINDOW_DAYS=3 npm run sdk:first-run
```

### 2) Manual local API + API key flow

Start the API with a local ops token:

```sh
export PROXY_OPS_TOKEN=dev_ops_token
npm run dev:api
```

In a second shell, create an API key for SDK calls:

```sh
export NOOTERRA_BASE_URL=http://127.0.0.1:3000
export NOOTERRA_TENANT_ID=tenant_default
export NOOTERRA_API_KEY="$(
  curl -sS -X POST "$NOOTERRA_BASE_URL/ops/api-keys" \
    -H "authorization: Bearer $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID" \
    -H "content-type: application/json" \
    -d '{"scopes":["ops_read","ops_write","finance_read","finance_write","audit_read"],"description":"sdk quickstart"}' \
  | jq -r '.keyId + "." + .secret'
)"
```

Run the repo example:

```sh
node scripts/examples/sdk-first-verified-run.mjs
```

### 3) Run ACS substrate smoke flow (JS SDK)

This exercises discovery, delegation grants, authority grants, negotiation, work orders, state checkpoints, session lineage, reputation graph wrappers, and capability attestations end-to-end.

```sh
npm run sdk:acs-smoke
```

Expected output:

```json
{
  "principalAgentId": "agt_js_acs_principal_...",
  "workerAgentId": "agt_js_acs_worker_...",
  "delegationGrantId": "dgrant_...",
  "authorityGrantId": "agrant_...",
  "workOrderId": "workord_...",
  "workOrderStatus": "completed",
  "completionStatus": "success",
  "sessionId": "sess_...",
  "checkpointId": "chkpt_...",
  "checkpointHash": "sha256...",
  "attestationId": "catt_..."
}
```

## Pull tenant analytics + trust graph (Magic Link)

```js
const analytics = await client.getTenantAnalytics("tenant_default", { month: "2026-02", bucket: "day", limit: 20 });
const graph = await client.getTenantTrustGraph("tenant_default", { month: "2026-02", minRuns: 1, maxEdges: 200 });
const diff = await client.diffTenantTrustGraph("tenant_default", { baseMonth: "2026-01", compareMonth: "2026-02", limit: 50 });
```

Or run the prebuilt script from this repo:

```sh
NOOTERRA_BASE_URL=http://127.0.0.1:8787 \
NOOTERRA_TENANT_ID=tenant_default \
NOOTERRA_X_API_KEY=test_key \
npm run sdk:analytics
```
