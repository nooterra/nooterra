# Quickstart: First verified agent run with the SDK

Goal: run one end-to-end agent transaction (register identities, append run events, verify `green`, release settlement) using `NooterraClient.firstVerifiedRun(...)`.

## 0) Install deps

```sh
npm ci
```

## Fast Path (recommended)

Use the helper scripts to avoid manual export churn across shells:

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

## 1) Start the API with a local ops token

```sh
export PROXY_OPS_TOKEN=dev_ops_token
npm run dev:api
```

## 2) Create an API key for SDK calls

In a second shell:

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

## 3) Run the SDK example

```sh
node scripts/examples/sdk-first-verified-run.mjs
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

## 3b) Run ACS substrate smoke flow (JS SDK)

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

## 4) Use the helper directly in code

```js
import { NooterraClient } from "./packages/api-sdk/src/index.js";

const client = new NooterraClient({
  baseUrl: process.env.NOOTERRA_BASE_URL,
  tenantId: process.env.NOOTERRA_TENANT_ID,
  apiKey: process.env.NOOTERRA_API_KEY,
  xApiKey: process.env.NOOTERRA_X_API_KEY // optional for Magic Link deployments that enforce x-api-key
});

const result = await client.firstVerifiedRun({
  payeeAgent: { publicKeyPem: "...", owner: { ownerType: "service", ownerId: "svc_a" } },
  payerAgent: { publicKeyPem: "...", owner: { ownerType: "service", ownerId: "svc_b" } },
  payerCredit: { amountCents: 5000 },
  settlement: { amountCents: 1200 },
  run: { taskType: "translation" }
});
```

## 5) Pull tenant analytics + trust graph (Magic Link)

```js
const analytics = await client.getTenantAnalytics("tenant_default", { month: "2026-02", bucket: "day", limit: 20 });
const graph = await client.getTenantTrustGraph("tenant_default", { month: "2026-02", minRuns: 1, maxEdges: 200 });
const diff = await client.diffTenantTrustGraph("tenant_default", { baseMonth: "2026-01", compareMonth: "2026-02", limit: 50 });
```

Or run the prebuilt script:

```sh
NOOTERRA_BASE_URL=http://127.0.0.1:8787 \
NOOTERRA_TENANT_ID=tenant_default \
NOOTERRA_X_API_KEY=test_key \
npm run sdk:analytics
```
