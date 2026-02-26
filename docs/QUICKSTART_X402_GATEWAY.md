# Quickstart: x402 Gateway (Verify Before Release)

Goal: in ~10 minutes, run a local Nooterra API + a mock x402 upstream + the Nooterra x402 gateway, then complete a `402 -> authorize -> verify -> release` flow and get a deterministic receipt trail.

## TL;DR (one command)

```bash
npm ci && npm run quickstart:x402
```

Success: prints `OK`, `gateId=...`, and `gateStateUrl=...`.

By default the script keeps services running until you press Ctrl+C. To run once and exit (CI-friendly):

```bash
npm ci && NOOTERRA_QUICKSTART_KEEP_ALIVE=0 npm run quickstart:x402
```

If you already ran `npm ci` in this repo, you can skip it:

```bash
npm run quickstart:x402
```

Ports can be overridden if you already have something running on `3000/8402/9402`:

- `NOOTERRA_QUICKSTART_API_PORT`
- `NOOTERRA_QUICKSTART_GATEWAY_PORT`
- `NOOTERRA_QUICKSTART_UPSTREAM_PORT`

## 0) Prereqs

- Node.js 20.x (`nvm use` in repo root)
- Bash (for the copy/paste snippets below)
- `curl`

Optional:

- Docker Engine 20.10+ (only if you want to run the gateway via container)
  - Linux: this quickstart includes Linux-safe Docker networking options (do not assume `host.docker.internal` works without configuration).

## 1) Start a local Nooterra API (in-memory)

From repo root:

```bash
npm ci
```

Then:

```bash
PROXY_OPS_TOKEN=tok_ops PORT=3000 npm run dev:api
```

In another terminal, confirm:

```bash
curl -fsS http://127.0.0.1:3000/healthz
```

## 2) Mint an API key (no jq required)

This mints a tenant API key using the dev ops token (`PROXY_OPS_TOKEN`). The gateway uses `NOOTERRA_API_KEY` (not the ops token) to call Nooterra.

```bash
NOOTERRA_API_KEY="$(
  set -euo pipefail
  curl -fsS -X POST http://127.0.0.1:3000/ops/api-keys \
    -H "x-proxy-ops-token: tok_ops" \
    -H "authorization: Bearer tok_ops" \
    -H "x-proxy-tenant-id: tenant_default" \
    -H "content-type: application/json" \
    -d '{"scopes":["ops_read","ops_write","finance_read","finance_write","audit_read"],"description":"x402 gateway quickstart"}' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);if(!j?.keyId||!j?.secret){console.error("unexpected response:",d);process.exit(1)}process.stdout.write(`${j.keyId}.${j.secret}`)})'
)"
export NOOTERRA_API_KEY
if [ -n "$NOOTERRA_API_KEY" ]; then
  echo "NOOTERRA_API_KEY minted"
else
  echo "FAILED: NOOTERRA_API_KEY empty" >&2
fi
```

## 3) Start a mock x402 upstream

The upstream will return `HTTP 402` with both `x-payment-required` and `PAYMENT-REQUIRED` until the gateway retries with a `NooterraPay` authorization token.

```bash
PORT=9402 \
NOOTERRA_PAY_KEYSET_URL='http://127.0.0.1:3000/.well-known/nooterra-keys.json' \
node services/x402-gateway/examples/upstream-mock.js
```

If your Nooterra API is not on port `3000`, set `NOOTERRA_PAY_KEYSET_URL` to the correct `/.well-known/nooterra-keys.json` URL so the provider can verify NooterraPay tokens offline.

In another terminal:

```bash
curl -fsS http://127.0.0.1:9402/healthz
```

### Strict request binding for side-effecting tools

For side-effecting tools, set provider offer `requestBindingMode: "strict"` (or `idempotency: "side_effecting"` in manifests that feed the provider wrapper). In strict mode, provider-kit computes a canonical request fingerprint and requires the NooterraPay token payload to carry a matching `requestBindingSha256`. Replaying the same token with a different path/query/body is rejected with `402` and code `NOOTERRA_PAY_REQUEST_BINDING_MISMATCH`.

## 3.5) Provider signature key (demo)

This quickstart uses provider-signed responses as a minimal correctness check:

- the upstream mock signs a response hash with Ed25519
- the gateway verifies the signature before releasing funds

Export the upstream mock's dev-only public key:

```bash
export X402_PROVIDER_PUBLIC_KEY_PEM="$(cat <<'EOF'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7zJ+oQLAO6F4Xewe7yJB1mv5TxsLo5bGZI7ZJPuFB6s=
-----END PUBLIC KEY-----
EOF
)"
```

## 4) Start the x402 gateway (thin proxy)

### Option A: run from source (fastest)

```bash
NOOTERRA_API_URL="http://127.0.0.1:3000" \
NOOTERRA_API_KEY="$NOOTERRA_API_KEY" \
UPSTREAM_URL="http://127.0.0.1:9402" \
HOLDBACK_BPS=0 \
DISPUTE_WINDOW_MS=3600000 \
X402_AUTOFUND=1 \
X402_PROVIDER_PUBLIC_KEY_PEM="$X402_PROVIDER_PUBLIC_KEY_PEM" \
PORT=8402 \
npm run dev:x402-gateway
```

Notes:

- `X402_AUTOFUND=1` is for local demo only. It simulates funding the payer so escrow holds can be created without a real payment rail.

### Option B: run via Docker (same config surface)

Important:

- On macOS/Windows (Docker Desktop), `host.docker.internal` works by default.
- On Linux, `host.docker.internal` is usually not defined. If you run the gateway in Docker while your Nooterra API + mock upstream are running on the host, use one of the Linux commands below:
  - Recommended: `--add-host=host.docker.internal:host-gateway` (Docker Engine 20.10+)
  - Alternative: `--network host` and use `127.0.0.1` URLs (not available on Docker Desktop; often not supported with rootless Docker)

Pull the image:

```bash
docker pull ghcr.io/nooterra/nooterra/x402-gateway:latest
```

If `docker pull` fails with `denied`, either:

- build locally from this repo (no dependencies; copies `src/core` + `services/x402-gateway`):

```bash
docker build -t nooterra/x402-gateway:local -f services/x402-gateway/Dockerfile .
```

and replace `ghcr.io/nooterra/nooterra/x402-gateway:latest` with `nooterra/x402-gateway:local` in the `docker run` commands below.

macOS/Windows (Docker Desktop):

```bash
docker run --rm -p 8402:8402 \
  -e NOOTERRA_API_URL="http://host.docker.internal:3000" \
  -e NOOTERRA_API_KEY="$NOOTERRA_API_KEY" \
  -e UPSTREAM_URL="http://host.docker.internal:9402" \
  -e HOLDBACK_BPS=0 \
  -e DISPUTE_WINDOW_MS=3600000 \
  -e X402_AUTOFUND=1 \
  -e X402_PROVIDER_PUBLIC_KEY_PEM="$X402_PROVIDER_PUBLIC_KEY_PEM" \
  -e PORT=8402 \
  ghcr.io/nooterra/nooterra/x402-gateway:latest
```

Linux (recommended, bridge networking):

```bash
docker run --rm -p 8402:8402 \
  --add-host=host.docker.internal:host-gateway \
  -e NOOTERRA_API_URL="http://host.docker.internal:3000" \
  -e NOOTERRA_API_KEY="$NOOTERRA_API_KEY" \
  -e UPSTREAM_URL="http://host.docker.internal:9402" \
  -e HOLDBACK_BPS=0 \
  -e DISPUTE_WINDOW_MS=3600000 \
  -e X402_AUTOFUND=1 \
  -e X402_PROVIDER_PUBLIC_KEY_PEM="$X402_PROVIDER_PUBLIC_KEY_PEM" \
  -e PORT=8402 \
  ghcr.io/nooterra/nooterra/x402-gateway:latest
```

Linux alternative (host networking):

```bash
docker run --rm --network host \
  -e NOOTERRA_API_URL="http://127.0.0.1:3000" \
  -e NOOTERRA_API_KEY="$NOOTERRA_API_KEY" \
  -e UPSTREAM_URL="http://127.0.0.1:9402" \
  -e HOLDBACK_BPS=0 \
  -e DISPUTE_WINDOW_MS=3600000 \
  -e X402_AUTOFUND=1 \
  -e X402_PROVIDER_PUBLIC_KEY_PEM="$X402_PROVIDER_PUBLIC_KEY_PEM" \
  -e PORT=8402 \
  ghcr.io/nooterra/nooterra/x402-gateway:latest
```

Confirm:

```bash
curl -fsS http://127.0.0.1:8402/healthz
```

## 5) Drive the 402 -> verify -> release flow

### 5.0 One-shot smoke test (copy/paste; fails fast)

This asserts the expected HTTP status codes and (with the default upstream + gateway config in this doc) checks that the released/refunded cents are consistent.

```bash
set -euo pipefail

h402="$(curl -sS -D - -o /dev/null http://127.0.0.1:8402/resource)"
echo "$h402" | grep -qE '^HTTP/.* 402 '
echo "$h402" | grep -qi '^x-payment-required:'
amount_cents="$(echo "$h402" | tr -d '\r' | grep -i '^x-payment-required:' | sed -n 's/.*amountCents=\([0-9][0-9]*\).*/\1/p' | head -n 1)"
test -n "$amount_cents"
GATE_ID="$(echo "$h402" | awk 'tolower($1) == "x-nooterra-gate-id:" {print $2}' | tr -d '\r' | head -n 1)"
test -n "$GATE_ID"
echo "gateId=$GATE_ID"

h200="$(curl -sS -D - -o /dev/null http://127.0.0.1:8402/resource -H "x-nooterra-gate-id: $GATE_ID")"
echo "$h200" | grep -qE '^HTTP/.* 200 '

settlement_status="$(echo "$h200" | awk 'tolower($1) == "x-nooterra-settlement-status:" {print $2}' | tr -d '\r' | head -n 1)"
released_cents="$(echo "$h200" | awk 'tolower($1) == "x-nooterra-released-amount-cents:" {print $2}' | tr -d '\r' | head -n 1)"
refunded_cents="$(echo "$h200" | awk 'tolower($1) == "x-nooterra-refunded-amount-cents:" {print $2}' | tr -d '\r' | head -n 1)"
test "$settlement_status" = "released"
test "$released_cents" = "$amount_cents"
test "$refunded_cents" = "0"

echo "OK"
```

Notes:

- If you set `HOLDBACK_BPS>0`, the gateway may emit `x-nooterra-holdback-*` headers (a follow-on settlement).

### 5.1 First request (expect 402 + x-nooterra-gate-id)

```bash
curl -isS http://127.0.0.1:8402/resource | sed -n '1,40p'
```

Extract the gate id:

```bash
GATE_ID="$(
  curl -isS http://127.0.0.1:8402/resource \
    | awk 'tolower($1) == "x-nooterra-gate-id:" {print $2}' \
    | tr -d '\r' \
    | head -n 1
)"
echo "gateId=$GATE_ID"
```

### 5.2 Second request (retry with gate id; gateway auto-authorizes payment)

```bash
curl -isS http://127.0.0.1:8402/resource \
  -H "x-nooterra-gate-id: $GATE_ID" | sed -n '1,80p'
```

You should see:

- `HTTP 200`
- `x-nooterra-response-sha256: ...`
- `x-nooterra-verification-status: green|red`
- `x-nooterra-verification-codes: ...` (optional; reason codes when verification is forced red)
- `x-nooterra-settlement-status: released`
- `x-nooterra-released-amount-cents`, `x-nooterra-refunded-amount-cents`
- `x-nooterra-holdback-status`, `x-nooterra-holdback-amount-cents` (when `HOLDBACK_BPS>0`)

## 6) Inspect the gate state (optional)

```bash
curl -fsS "http://127.0.0.1:3000/x402/gate/$GATE_ID" \
  -H "x-proxy-tenant-id: tenant_default" \
  -H "authorization: Bearer $NOOTERRA_API_KEY" \
  -H "x-nooterra-protocol: 1.0"
```

You can also inspect the gateway signing keyset used for `NooterraPay` verification:

```bash
curl -fsS "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
```

## Troubleshooting

- If the gateway never returns `x-nooterra-gate-id`, your upstream likely isn’t returning `402` with `x-payment-required`.
- If `/x402/gate/verify` fails with insufficient funds, you forgot `X402_AUTOFUND=1` (local demo) or you need a real funding path wired in.
- Linux + Docker: if the gateway container can’t reach `http://host.docker.internal:3000` / `:9402`, use `--add-host=host.docker.internal:host-gateway` or `--network host` (and point `NOOTERRA_API_URL`/`UPSTREAM_URL` at `http://127.0.0.1:...`).
- If you see `EADDRINUSE` (port already in use), pick different ports (the one-command quickstart supports `NOOTERRA_QUICKSTART_API_PORT`, `NOOTERRA_QUICKSTART_UPSTREAM_PORT`, and `NOOTERRA_QUICKSTART_GATEWAY_PORT`).

If you tried and failed:

- Run `./scripts/collect-debug.sh` and attach the resulting `nooterra-debug-*.tar.gz` to a GitHub issue using the "Quickstart failure" template:
  - https://github.com/nooterra/nooterra/issues/new?template=quickstart-failure.yml
