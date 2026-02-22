# Quickstart

Get from zero to a verified paid agent action in minutes.

## Prerequisites

- Node.js 20+
- Settld API URL
- Tenant ID
- Tenant API key (`keyId.secret`)

## 0) One-command setup

Run guided setup:

```bash
settld setup
```

The guided setup uses arrow-key menus for host/wallet/policy decisions, then asks only the next required fields.

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

## 2) Verify MCP connectivity

```bash
npm run mcp:probe -- --call settld.about '{}'
```

Expected outcome:

- `settld.about` succeeds
- host can discover `settld.*` tools

## 3) Run first paid call

```bash
npm run demo:mcp-paid-exa
```

Expected output includes:

- `PASS artifactDir=...`
- `gateId=...`
- `decisionId=...`
- `settlementReceiptId=...`

## 4) Verify first receipt (proof packet)

```bash
jq -c 'first' <artifactDir>/x402-receipts.export.jsonl > /tmp/settld-first-receipt.json
settld x402 receipt verify /tmp/settld-first-receipt.json --format json --json-out /tmp/settld-first-receipt.verify.json
```

`/tmp/settld-first-receipt.verify.json` is your deterministic verification artifact for audit/compliance.

## 5) Optional: policy profile workflows

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
- Host cannot find MCP tools
  - rerun setup, restart host, then rerun `npm run mcp:probe`.
