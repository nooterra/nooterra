# Quickstart: x402 Gateway (Verify Before Release)

Goal: in ~10 minutes, run a local Settld API + a mock x402 upstream + the Settld x402 gateway, then complete a `402 -> hold -> verify -> release` flow and get a deterministic receipt trail.

## 0) Prereqs

- Node.js 20+
- `curl`

Optional:

- Docker (only if you want to run the gateway via container)

## 1) Start a local Settld API (in-memory)

From repo root:

```bash
PROXY_OPS_TOKEN=tok_ops PORT=3000 npm run dev:api
```

In another terminal, confirm:

```bash
curl -fsS http://127.0.0.1:3000/healthz
```

## 2) Mint an API key (no jq required)

This key is what the gateway uses to call Settld.

```bash
SETTLD_API_KEY="$(
  curl -fsS -X POST http://127.0.0.1:3000/ops/api-keys \
    -H "x-proxy-ops-token: tok_ops" \
    -H "authorization: Bearer tok_ops" \
    -H "x-proxy-tenant-id: tenant_default" \
    -H "content-type: application/json" \
    -d '{"scopes":["ops_read","ops_write","finance_read","finance_write","audit_read"],"description":"x402 gateway quickstart"}' \
  | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{const j=JSON.parse(d);process.stdout.write(`${j.keyId}.${j.secret}`)})'
)"
export SETTLD_API_KEY
test -n "$SETTLD_API_KEY" && echo "SETTLD_API_KEY minted"
```

## 3) Start a mock x402 upstream

The upstream will return `HTTP 402` with `x-payment-required` until you retry with `x-payment: paid`.

```bash
PORT=9402 node services/x402-gateway/examples/upstream-mock.js
```

In another terminal:

```bash
curl -fsS http://127.0.0.1:9402/healthz
```

## 4) Start the x402 gateway (thin proxy)

### Option A: run from source (fastest)

```bash
SETTLD_API_URL="http://127.0.0.1:3000" \
SETTLD_API_KEY="$SETTLD_API_KEY" \
UPSTREAM_URL="http://127.0.0.1:9402" \
HOLDBACK_BPS=1000 \
DISPUTE_WINDOW_MS=86400000 \
X402_AUTOFUND=1 \
PORT=8402 \
npm run dev:x402-gateway
```

Notes:

- `X402_AUTOFUND=1` is for local demo only. It simulates funding the payer so escrow holds can be created without a real payment rail.

### Option B: run via Docker (same config surface)

```bash
docker pull ghcr.io/aidenlippert/settld/x402-gateway:latest

docker run --rm -p 8402:8402 \
  -e SETTLD_API_URL="http://host.docker.internal:3000" \
  -e SETTLD_API_KEY="$SETTLD_API_KEY" \
  -e UPSTREAM_URL="http://host.docker.internal:9402" \
  -e HOLDBACK_BPS=1000 \
  -e DISPUTE_WINDOW_MS=86400000 \
  -e X402_AUTOFUND=1 \
  -e PORT=8402 \
  ghcr.io/aidenlippert/settld/x402-gateway:latest
```

Confirm:

```bash
curl -fsS http://127.0.0.1:8402/healthz
```

## 5) Drive the 402 -> verify -> release flow

### 5.1 First request (expect 402 + x-settld-gate-id)

```bash
curl -isS http://127.0.0.1:8402/resource | sed -n '1,40p'
```

Extract the gate id:

```bash
GATE_ID="$(
  curl -isS http://127.0.0.1:8402/resource \
    | awk 'BEGIN{IGNORECASE=1} $1 ~ /^x-settld-gate-id:$/ {print $2}' \
    | tr -d '\r' \
    | head -n 1
)"
echo "gateId=$GATE_ID"
```

### 5.2 Second request (retry with gate id + mock payment proof)

```bash
curl -isS http://127.0.0.1:8402/resource \
  -H "x-settld-gate-id: $GATE_ID" \
  -H "x-payment: paid" | sed -n '1,80p'
```

You should see `x-settld-*` headers indicating the verify+decision result.

## 6) Inspect the gate state (optional)

```bash
curl -fsS "http://127.0.0.1:3000/x402/gate/$GATE_ID" \
  -H "x-proxy-tenant-id: tenant_default" \
  -H "authorization: Bearer $SETTLD_API_KEY" \
  -H "x-settld-protocol: 1.0"
```

## Troubleshooting

- If the gateway never returns `x-settld-gate-id`, your upstream likely isn’t returning `402` with `x-payment-required`.
- If `/x402/gate/verify` fails with insufficient funds, you forgot `X402_AUTOFUND=1` (local demo) or you need a real funding path wired in.

