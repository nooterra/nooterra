# Nooterra x402 Gateway (S24)

Thin proxy that sits between your client and an upstream x402-style API, and converts `HTTP 402` into a Nooterra `hold -> verify -> release/refund` settlement.

## Config

Required:

- `NOOTERRA_API_URL`
- `NOOTERRA_API_KEY` (format: `keyId.secret`)
- `UPSTREAM_URL`

Optional:

- `HOLDBACK_BPS` (default `0`)
- `DISPUTE_WINDOW_MS` (default `3600000`)
- `X402_AUTOFUND` (default `false`) (local demo only; do not use in production)
- `X402_PROVIDER_PUBLIC_KEY_PEM` (optional; if set, the gateway requires a provider signature on responses and will not release funds without it)
- `PORT` (default `8402`)

Notes:

- The gateway forwards `x-proxy-tenant-id` to Nooterra if present on the incoming request; otherwise it uses `tenant_default`.
- For Nooterra writes it sends `x-nooterra-protocol=1.0`.

## Run (Docker)

From repo root:

```bash
# Preferred: pull the published image from GHCR.
docker pull ghcr.io/nooterra/nooterra/x402-gateway:latest

# Or build from source:
# docker build -f services/x402-gateway/Dockerfile -t nooterra/x402-gateway:dev .

docker run --rm -p 8402:8402 \
  -e X402_AUTOFUND=0 \
  -e NOOTERRA_API_URL="http://host.docker.internal:3000" \
  -e NOOTERRA_API_KEY="YOUR_KEY_ID.YOUR_SECRET" \
  -e UPSTREAM_URL="https://example.com" \
  ghcr.io/nooterra/nooterra/x402-gateway:latest
```

Linux (Docker Engine 20.10+): add `--add-host=host.docker.internal:host-gateway` to the `docker run` command.

## Usage

1. Send your normal request through the gateway: `http://127.0.0.1:8402/...`
2. If upstream returns `402` with `x-payment-required` (or `PAYMENT-REQUIRED`), the gateway responds `402` and includes `x-nooterra-gate-id`.
3. Retry the upstream request through the gateway, but include `x-nooterra-gate-id: <value>`.
4. When the upstream returns `200`, the gateway calls Nooterra `/x402/gate/verify` and returns `x-nooterra-*` result headers:

- `x-nooterra-gate-id`
- `x-nooterra-response-sha256`
- `x-nooterra-verification-status` + `x-nooterra-verification-codes`
- `x-nooterra-settlement-status` + `x-nooterra-released-amount-cents` + `x-nooterra-refunded-amount-cents`
- optional: `x-nooterra-holdback-status` + `x-nooterra-holdback-amount-cents`
