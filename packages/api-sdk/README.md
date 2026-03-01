# nooterra-api-sdk

Node/TypeScript SDK for Nooterra API + x402 helpers.

Core ACS surface in `NooterraClient` includes:
- agent cards + discovery (`upsertAgentCard`, `discoverAgentCards`, `discoverPublicAgentCards`, `streamPublicAgentCards`)
- reputation + relationship graph (`getPublicAgentReputationSummary`, `getAgentInteractionGraphPack`, `listRelationships`)
- delegation + authority grants (`createDelegationGrant`, `createAuthorityGrant`)
- task negotiation (`createTaskQuote`, `createTaskOffer`, `createTaskAcceptance`)
- work-order lifecycle + metering + completion receipts (`createWorkOrder`, `acceptWorkOrder`, `progressWorkOrder`, `topUpWorkOrder`, `getWorkOrderMetering`, `completeWorkOrder`, `settleWorkOrder`, `listWorkOrderReceipts`, `getWorkOrderReceipt`)
- state checkpoints (`createStateCheckpoint`, `listStateCheckpoints`, `getStateCheckpoint`)
- session lineage (`createSession`, `listSessions`, `listSessionEvents`, `streamSessionEvents`, `appendSessionEvent`, `getSessionReplayPack`, `getSessionTranscript`)
- capability attestations (`createCapabilityAttestation`, `revokeCapabilityAttestation`)

Quickstarts:
- JS SDK: `docs/QUICKSTART_SDK.md`
- Python SDK: `docs/QUICKSTART_SDK_PYTHON.md`
- JS ACS smoke flow: `npm run sdk:acs-smoke`
- Python ACS smoke flow: `npm run sdk:acs-smoke:py`

## Transport Parity Adapters (HTTP + MCP)

Use parity adapters when you need the same payload/error/retry/idempotency semantics across HTTP and MCP transports:

- `client.createHttpParityAdapter(...)`
- `client.createMcpParityAdapter({ callTool, ... })`

Quickstart:

```js
const httpAdapter = client.createHttpParityAdapter({
  maxAttempts: 2,
  retryStatusCodes: [503],
  retryDelayMs: 0
});

const mcpAdapter = client.createMcpParityAdapter({
  callTool,
  maxAttempts: 2,
  retryStatusCodes: [503],
  retryDelayMs: 0
});

const httpOperation = {
  operationId: "run_dispute_evidence_submit",
  method: "POST",
  path: "/runs/run_1/dispute/evidence",
  requiredFields: ["disputeId", "evidenceRef"],
  idempotencyRequired: true,
  expectedPrevChainHashRequired: true
};

const mcpOperation = {
  operationId: "run_dispute_evidence_submit",
  toolName: "nooterra.run_dispute_evidence_submit",
  requiredFields: ["disputeId", "evidenceRef"],
  idempotencyRequired: true,
  expectedPrevChainHashRequired: true
};

await httpAdapter.invoke(httpOperation, payload, {
  idempotencyKey: "idem_run_1_dispute_evidence",
  expectedPrevChainHash: prevChainHash
});
await mcpAdapter.invoke(mcpOperation, payload, {
  idempotencyKey: "idem_run_1_dispute_evidence",
  expectedPrevChainHash: prevChainHash
});
```

Reuse the same idempotency key across retries, and pass `expectedPrevChainHash` for chain-bound writes. Missing either fails closed with `PARITY_*`.

Both adapters return a shared response envelope:
- `ok`, `status`, `requestId`, `body`, `headers`
- `transport`, `operationId`, `idempotencyKey`, `attempts`

Both adapters fail with a stable `error.nooterra` shape that includes:
- `status`, `code`, `message`, `details`, `requestId`
- `retryable`, `attempts`, `transport`, `operationId`

## Deterministic Helpers

Use deterministic helpers for canonical payload hashing and reproducible signatures:

- `canonicalJsonStringifyDeterministic(value)`
- `computeCanonicalSha256(value)`
- `buildCanonicalEnvelope(value)`

```js
import { canonicalJsonStringifyDeterministic, computeCanonicalSha256, buildCanonicalEnvelope } from "nooterra-api-sdk";

const canonicalJson = canonicalJsonStringifyDeterministic({ b: 2, a: 1 });
// canonicalJson === '{"a":1,"b":2}'

const sha256 = computeCanonicalSha256({ b: 2, a: 1 });
const envelope = buildCanonicalEnvelope({ b: 2, a: 1 });
// envelope => { canonicalJson: '{"a":1,"b":2}', sha256: <hex> }
```

These helpers are transport-neutral and align with SDK core object builders (`createAgreement`, `signEvidence`, `buildDisputeOpenEnvelope`).

Safety caveats for integration:
- Treat `PARITY_*` validation errors as hard-stop conditions. Do not bypass them.
- Idempotency is fail-closed by default (`idempotencyRequired: true`). Set `idempotencyRequired: false` only for explicitly safe read operations.
- For safety-critical writes, keep the same idempotency key across retries.
- For chain-bound writes, require `expectedPrevChainHash` (`expectedPrevChainHashRequired: true`) so retries stay causally bound.
- Keep retry policy deterministic (fixed delay or deterministic delay function) and avoid transport-specific fallback logic outside the adapter.

## Webhook Signature Verification

Use `verifyNooterraWebhookSignature` to verify incoming `x-nooterra-signature` headers with:

- multi-signature support (`v1=...` list, including rotation windows),
- constant-time comparison (`crypto.timingSafeEqual`),
- timestamp tolerance checks (replay protection).

```js
import express from "express";
import { verifyNooterraWebhookSignature } from "nooterra-api-sdk";

const app = express();

// IMPORTANT: keep the raw body; do not JSON-parse before verification.
app.post("/webhooks/nooterra", express.raw({ type: "application/json" }), (req, res) => {
  const signatureHeader = req.get("x-nooterra-signature") ?? "";
  const timestamp = req.get("x-nooterra-timestamp"); // required for current Nooterra delivery format
  const secret = process.env.NOOTERRA_WEBHOOK_SECRET;

  verifyNooterraWebhookSignature(req.body, signatureHeader, secret, {
    timestamp,
    toleranceSeconds: 300
  });

  const event = JSON.parse(req.body.toString("utf8"));
  // handle event...
  res.status(200).json({ ok: true });
});
```

The verifier also supports signature headers that embed timestamp directly:

`x-nooterra-signature: t=1708380000,v1=<sig-new>,v1=<sig-old>`

## Express Middleware Helper

Use `verifyNooterraWebhook` to verify signatures in an Express-style middleware.

```js
import express from "express";
import { verifyNooterraWebhook } from "nooterra-api-sdk";

const app = express();
const secret = process.env.NOOTERRA_WEBHOOK_SECRET;

// IMPORTANT: preserve raw body bytes before JSON parsing mutates payload shape.
app.use(
  express.json({
    verify(req, _res, buf) {
      req.rawBody = buf;
    }
  })
);

app.post(
  "/webhooks/nooterra",
  verifyNooterraWebhook(secret, { toleranceSeconds: 300 }),
  (req, res) => {
    const event = req.body;
    // handle event...
    res.status(200).json({ ok: true });
  }
);
```

If `req.rawBody` is missing (or `req.body` is already parsed into a plain object), the middleware returns `400` with a raw-body guidance message.
