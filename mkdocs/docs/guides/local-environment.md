# Local Environment

Use this when you want full local iteration for API, onboarding, and receipt verification.

## 1) Initialize local env files

```bash
npm run dev:env:init
```

Edit `.env.dev` and set at minimum:

- `DATABASE_URL`
- `NOOTERRA_BASE_URL` (default `http://127.0.0.1:3000`)
- `NOOTERRA_TENANT_ID` (default `tenant_default`)
- `PROXY_OPS_TOKEN`

## 2) Start local API

```bash
npm run dev:start
```

Optional services:

```bash
npm run dev:magic-link
npm run dev:receiver
npm run dev:finance-sink
```

## 3) Mint a runtime API key for local testing

```bash
npm run dev:sdk:key
```

This writes `.env.dev.runtime` with `NOOTERRA_API_KEY`.

## 4) Run a first verified run locally

```bash
npm run dev:sdk:first-run
```

## 5) Recommended local health checks

```bash
npm run test:ci:runtime-import-smoke
npm run test:cli:pack-smoke
npm run test:ci:mcp-host-smoke
```

## 6) Full regression (slower)

```bash
npm test
```
