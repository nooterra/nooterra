# Quickstart

Get from zero to a verified paid agent action in minutes.

## Prerequisites

- Node.js 20.x (`nvm use` in repo root). Install is fail-fast if you use a different major.
- Public flow: no API key required up front (`settld setup` handles login/session bootstrap)
- Advanced flow: optional explicit `--base-url`, `--tenant-id`, and `--settld-api-key`

## 0) One-command setup

Run guided setup:

```bash
settld setup
```

Recommended interactive choices:

1. host
2. `quick` setup mode
3. wallet mode
4. OTP login (creates tenant if needed)

`quick` mode auto-runs preflight/smoke/profile apply, then starts guided wallet fund + first paid call checks.

Non-interactive example:

```bash
settld setup --non-interactive \
  --host codex \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --settld-api-key sk_live_xxx.yyy \
  --wallet-mode managed \
  --wallet-bootstrap remote \
  --profile-id engineering-spend \
  --smoke \
  --out-env ./.tmp/settld.env
```

What this does:

- configures host MCP wiring
- sets runtime env and policy passport
- applies starter profile
- runs connectivity smoke checks

## 1) Activate your host

If you wrote an env file, load it:

```bash
source ./.tmp/settld.env
```

Then restart your host app (Codex/Claude/Cursor/OpenClaw) so it reloads MCP config.

## 2) Check wallet and fund it

```bash
settld login
settld wallet status
settld wallet fund --method transfer
settld wallet balance --watch --min-usdc 1
```

Optional methods:

```bash
settld wallet fund --open
settld wallet fund --method card --open
settld wallet fund --method bank --open
settld wallet fund --method faucet
```

For card/bank, configure one hosted provider URL strategy on the control-plane backend.

Option A (recommended): Coinbase Hosted Onramp:

```bash
export MAGIC_LINK_WALLET_FUND_PROVIDER='coinbase'
export MAGIC_LINK_COINBASE_API_KEY_VALUE='organizations/<org_id>/apiKeys/<key_id>'
export MAGIC_LINK_COINBASE_API_SECRET_KEY='-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----'
export MAGIC_LINK_COINBASE_PROJECT_ID='<project_id>'
export MAGIC_LINK_COINBASE_DESTINATION_NETWORK='base'
export MAGIC_LINK_COINBASE_ASSET='USDC'
export MAGIC_LINK_COINBASE_FIAT_CURRENCY='USD'
```

Option B: explicit card/bank hosted templates:

```bash
export MAGIC_LINK_WALLET_FUND_CARD_URL='https://pay.example.com/topup?tenant={tenantId}&method=card&address={walletAddress}'
export MAGIC_LINK_WALLET_FUND_BANK_URL='https://pay.example.com/topup?tenant={tenantId}&method=bank&address={walletAddress}'
```

## 3) Verify MCP connectivity

```bash
npm run mcp:probe -- --call settld.about '{}'
```

Expected outcome:

- `settld.about` succeeds
- host can discover `settld.*` tools

## 4) Run first paid call

```bash
npm run demo:mcp-paid-exa
```

Expected output includes:

- `PASS artifactDir=...`
- `gateId=...`
- `decisionId=...`
- `settlementReceiptId=...`

## 5) Verify first receipt (proof packet)

```bash
jq -c 'first' <artifactDir>/x402-receipts.export.jsonl > /tmp/settld-first-receipt.json
settld x402 receipt verify /tmp/settld-first-receipt.json --format json --json-out /tmp/settld-first-receipt.verify.json
```

`/tmp/settld-first-receipt.verify.json` is your deterministic verification artifact for audit/compliance.

## 6) Optional: policy profile workflows

```bash
settld profile list
settld profile init engineering-spend --out ./profiles/engineering-spend.profile.json
settld profile validate ./profiles/engineering-spend.profile.json --format json
settld profile simulate ./profiles/engineering-spend.profile.json --format json
```

## Troubleshooting

- `SETTLD_API_KEY must be a non-empty string`
  - ensure key is present in setup flags or shell env.
- `BYO wallet mode missing required env keys`
  - provide all required Circle keys in `docs/QUICKSTART_MCP_HOSTS.md`.
- `auth required: pass --cookie/--magic-link-api-key or run settld login first`
  - run `settld login`, then retry wallet commands.
- `no hosted funding URL configured for card/bank`
  - set backend Coinbase env (`MAGIC_LINK_WALLET_FUND_PROVIDER=coinbase`, `MAGIC_LINK_COINBASE_API_KEY_VALUE`, `MAGIC_LINK_COINBASE_API_SECRET_KEY`) or set explicit `MAGIC_LINK_WALLET_FUND_CARD_URL` / `MAGIC_LINK_WALLET_FUND_BANK_URL`.
  - pass `--hosted-url` for an ad-hoc override.
- Host cannot find MCP tools
  - rerun setup, restart host, then rerun `npm run mcp:probe`.
