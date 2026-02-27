# Quickstart: MCP Host Integrations (Nooterra, Claude, Cursor, OpenClaw)

This guide is the fastest path to wire Nooterra into an agent host and confirm a first verified paid action.

Target outcome:

1. Host can call `nooterra.*` MCP tools.
2. Wallet mode is configured (`managed`, `byo`, or `none`).
3. Policy profile is applied.
4. Smoke call and first paid receipt are green.

For deeper tool-level examples, see `docs/QUICKSTART_MCP.md`.

## 1) Before you run `nooterra setup`

Public default path (recommended):

- Node.js 20.x (`nvm use` in repo root). Install is fail-fast if you use a different major.
- no API keys required up front
- run `nooterra setup`, choose `quick`, then login with OTP
- setup creates tenant (if needed), mints runtime key, and wires MCP

Admin/operator path (advanced):

- explicit `NOOTERRA_BASE_URL`, `NOOTERRA_TENANT_ID`
- one of:
  - `NOOTERRA_API_KEY` (`keyId.secret`), or
  - `NOOTERRA_BOOTSTRAP_API_KEY` (bootstrap key that mints runtime key)

Recommended interactive pattern:

```bash
nooterra setup
```

Recommended non-interactive pattern (automation/support):

```bash
nooterra setup --non-interactive \
  --host openclaw \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --nooterra-api-key 'sk_live_xxx.yyy' \
  --wallet-mode managed \
  --wallet-bootstrap remote \
  --profile-id engineering-spend \
  --smoke \
  --out-env ./.tmp/nooterra-openclaw.env
```

If you want non-interactive setup to generate the tenant API key:

```bash
nooterra setup --non-interactive \
  --host openclaw \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --bootstrap-api-key 'ml_admin_xxx' \
  --wallet-mode managed \
  --wallet-bootstrap remote \
  --profile-id engineering-spend \
  --smoke
```

If you want validation only (no config writes):

```bash
nooterra setup --non-interactive \
  --host openclaw \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --nooterra-api-key 'sk_live_xxx.yyy' \
  --wallet-mode none \
  --preflight-only \
  --report-path ./.tmp/setup-preflight.json \
  --format json
```

## 2) Host setup flows

Unified setup command:

```bash
nooterra setup
```

`quick` mode (default) handles:

- host selection (`nooterra|claude|cursor|openclaw`)
- wallet mode selection (`managed|byo|none`)
- login/signup + OTP session flow (no manual key paste)
- preflight checks (API health, tenant auth, profile baseline, host config path)
- policy apply + optional smoke
- guided wallet funding and first paid MCP check
- interactive menus with arrow keys (Up/Down + Enter) for choice steps

`advanced` mode exposes explicit key/bootstrap/base-url prompts and fine-grained setup toggles.

Host-specific non-interactive examples:

```bash
# Nooterra
nooterra setup --non-interactive --host nooterra --base-url http://127.0.0.1:3000 --tenant-id tenant_default --nooterra-api-key sk_live_xxx.yyy --wallet-mode none --profile-id engineering-spend --smoke

# Claude
nooterra setup --non-interactive --host claude --base-url http://127.0.0.1:3000 --tenant-id tenant_default --nooterra-api-key sk_live_xxx.yyy --wallet-mode none --profile-id engineering-spend --smoke

# Cursor
nooterra setup --non-interactive --host cursor --base-url http://127.0.0.1:3000 --tenant-id tenant_default --nooterra-api-key sk_live_xxx.yyy --wallet-mode none --profile-id engineering-spend --smoke

# OpenClaw
nooterra setup --non-interactive --host openclaw --base-url http://127.0.0.1:3000 --tenant-id tenant_default --nooterra-api-key sk_live_xxx.yyy --wallet-mode none --profile-id engineering-spend --smoke
```

## 3) Wallet modes: managed vs BYO

### Managed (`--wallet-mode managed`)

Managed is the default and recommended first path.

`--wallet-bootstrap auto` behavior:

- If `--circle-api-key` (or `CIRCLE_API_KEY`) is present: local Circle bootstrap.
- If not present: remote onboarding bootstrap (`/v1/tenants/{tenantId}/onboarding/wallet-bootstrap`).

Force the path explicitly when needed:

```bash
# force remote wallet creation
nooterra setup --non-interactive --host openclaw --base-url https://api.nooterra.work --tenant-id tenant_default --nooterra-api-key 'sk_live_xxx.yyy' --wallet-mode managed --wallet-bootstrap remote --profile-id engineering-spend --smoke

# force local wallet creation with Circle credentials
nooterra setup --non-interactive --host openclaw --base-url https://api.nooterra.work --tenant-id tenant_default --nooterra-api-key 'sk_live_xxx.yyy' --wallet-mode managed --wallet-bootstrap local --circle-api-key 'TEST_API_KEY:...' --profile-id engineering-spend --smoke
```

### BYO (`--wallet-mode byo`)

Provide your own existing wallet values. Required keys:

- `CIRCLE_BASE_URL`
- `CIRCLE_BLOCKCHAIN`
- `CIRCLE_WALLET_ID_SPEND`
- `CIRCLE_WALLET_ID_ESCROW`
- `CIRCLE_TOKEN_ID_USDC`
- `CIRCLE_ENTITY_SECRET_HEX`

Pass as env or repeated `--wallet-env KEY=VALUE` flags:

```bash
nooterra setup --non-interactive \
  --host openclaw \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --nooterra-api-key 'sk_live_xxx.yyy' \
  --wallet-mode byo \
  --wallet-env CIRCLE_BASE_URL=https://api-sandbox.circle.com \
  --wallet-env CIRCLE_BLOCKCHAIN=BASE-SEPOLIA \
  --wallet-env CIRCLE_WALLET_ID_SPEND=wid_spend \
  --wallet-env CIRCLE_WALLET_ID_ESCROW=wid_escrow \
  --wallet-env CIRCLE_TOKEN_ID_USDC=token_usdc \
  --wallet-env CIRCLE_ENTITY_SECRET_HEX=$(openssl rand -hex 32) \
  --profile-id engineering-spend \
  --smoke
```

### None (`--wallet-mode none`)

Use this for policy/tooling setup without payment rails yet.

## 4) Activation after setup

`nooterra setup` writes host MCP config and prints `Combined exports`.

If you used `--out-env`, source it before running tools:

```bash
source ./.tmp/nooterra-openclaw.env
```

Then activate host-side:

- `nooterra`: restart Nooterra.
- `claude`: restart Claude Desktop.
- `cursor`: restart Cursor.
- `openclaw`: run `openclaw doctor`, ensure OpenClaw onboarding is complete (`openclaw onboard --install-daemon`), install plugin (`openclaw plugins install nooterra@latest`), run local verification (`openclaw agent --local --agent main --session-id nooterra-smoke --message "Use the tool named nooterra_about with empty arguments. Return only JSON." --json`), then run `openclaw tui --session main`.

## 5) Fund and verify wallet state

Check wallet assignment after setup:

```bash
nooterra wallet status
```

If wallet commands return auth errors, run:

```bash
nooterra login
```

Funding paths:

```bash
# Guided selector (recommended)
nooterra wallet fund --open

# Hosted flow (card/bank) - provider-hosted URL, add --open to launch browser
nooterra wallet fund --method card --open
nooterra wallet fund --method bank --open

# Direct transfer path (prints chain + destination address)
nooterra wallet fund --method transfer

# Sandbox only: request faucet top-up
nooterra wallet fund --method faucet
```

Provider-hosted card/bank links are configured on the control-plane backend.

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

Option B: explicit card/bank URLs:

```bash
# backend env (magic-link service)
export MAGIC_LINK_WALLET_FUND_CARD_URL='https://pay.example.com/topup?tenant={tenantId}&method=card&address={walletAddress}'
export MAGIC_LINK_WALLET_FUND_BANK_URL='https://pay.example.com/topup?tenant={tenantId}&method=bank&address={walletAddress}'
```

After funding, wait until spend wallet has balance:

```bash
nooterra wallet balance --watch --min-usdc 1
```

## 6) How the agent uses Nooterra after activation

After host activation, the agent interacts with Nooterra through MCP `nooterra.*` tools.

Typical flow:

1. Connectivity check: `nooterra.about`
2. Paid action: `nooterra.exa_search_paid` or `nooterra.weather_current_paid`
3. Policy gate + authorization happen server-side in Nooterra.
4. Nooterra records evidence/decision/receipt artifacts.
5. You can verify receipts offline (`nooterra x402 receipt verify`).

Quick local smoke:

```bash
npm run mcp:probe -- --call nooterra.about '{}'
```

First paid run + artifacts:

```bash
npm run demo:mcp-paid-exa
```

Verify first receipt from artifacts:

```bash
# replace <artifactDir> with the printed directory from demo output
nooterra x402 receipt verify <artifactDir>/x402-receipt.json --json-out /tmp/nooterra-first-receipt.json
```

## 7) Host config helper customization

Default host configuration logic is in:

- `scripts/setup/host-config.mjs`

If you need a custom resolver/writer, pass:

```bash
nooterra setup --host-config ./path/to/custom-host-config.mjs
```

Your helper should provide resolver/setup exports compatible with `scripts/setup/wizard.mjs`.

## 8) Troubleshooting

- `BYO wallet mode missing required env keys`
  - Provide all required Circle keys in section 3.
- `auth required: pass --cookie/--magic-link-api-key or run nooterra login first`
  - Run `nooterra login`, then retry `nooterra wallet status` / `nooterra wallet fund`.
- `no hosted funding URL configured for card/bank`
  - set backend Coinbase env (`MAGIC_LINK_WALLET_FUND_PROVIDER=coinbase`, `MAGIC_LINK_COINBASE_API_KEY_VALUE`, `MAGIC_LINK_COINBASE_API_SECRET_KEY`) or set explicit `MAGIC_LINK_WALLET_FUND_CARD_URL` / `MAGIC_LINK_WALLET_FUND_BANK_URL`.
  - pass `--hosted-url` for an ad-hoc override.
- `host config helper missing`
  - Add `scripts/setup/host-config.mjs` or pass `--host-config`.
- `NOOTERRA_API_KEY must be a non-empty string`
  - Ensure key is present in shell or setup flags.
- Host cannot run `npx`
  - Install Node.js 20.x and ensure `npx` is in `PATH`.
