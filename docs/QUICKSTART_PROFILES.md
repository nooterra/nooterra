# Quickstart: Profiles CLI

Goal: scaffold, validate, and simulate a policy profile with the Nooterra CLI.

## Prerequisites

- Node.js 20+
- Repo checkout with dependencies installed (`npm ci`)

## 0) One-command runtime setup (recommended before `profile apply`)

Non-interactive setup (manual mode):

```bash
./bin/nooterra.js setup --yes --mode manual --host nooterra --base-url http://127.0.0.1:3000 --tenant-id tenant_default --api-key sk_runtime_apply --profile-id engineering-spend
```

`nooterra setup` now also emits `NOOTERRA_PAID_TOOLS_AGENT_PASSPORT` automatically, so paid MCP tools run with policy-bound passport context without manual JSON editing.
Add `--smoke` if you want setup to run an immediate MCP probe before moving on.

Bootstrap mode (same flow, runtime key minted by onboarding endpoint):

```bash
./bin/nooterra.js setup --yes --mode bootstrap --host nooterra --base-url https://api.nooterra.work --tenant-id tenant_default --bootstrap-api-key mlk_admin_xxx --bootstrap-key-id sk_runtime --bootstrap-scopes runs:read,runs:write --idempotency-key profile_setup_bootstrap_1
```

If you only want runtime env + host wiring (without applying a profile), add:

```bash
--skip-profile-apply
```

To validate payment evidence early, run a paid demo after setup and verify the first exported receipt:

```bash
npm run demo:mcp-paid-exa
jq -c 'first' artifacts/mcp-paid-exa/*/x402-receipts.export.jsonl > /tmp/nooterra-first-receipt.json
nooterra x402 receipt verify /tmp/nooterra-first-receipt.json --format json --json-out /tmp/nooterra-first-receipt.verify.json
```

To verify MCP wiring immediately during setup, add:

```bash
--smoke
```

Single command that loads setup exports and applies a profile:

```bash
eval "$(./bin/nooterra.js setup --yes --mode manual --host nooterra --base-url http://127.0.0.1:3000 --tenant-id tenant_default --api-key sk_runtime_apply | grep '^export ')" && ./bin/nooterra.js profile apply ./profiles/engineering-spend.profile.json --format json
```

## 1) List available starter profiles

Installed CLI:

```bash
npx nooterra profile list
```

Repo checkout:

```bash
./bin/nooterra.js profile list
```

Example output:

```text
engineering-spend	engineering	Engineering Spend	<profile_fingerprint_sha256>
procurement	procurement	Procurement	<profile_fingerprint_sha256>
data-api-buyer	data	Data API Buyer	<profile_fingerprint_sha256>
support-automation	support	Support Automation	<profile_fingerprint_sha256>
finance-controls	finance	Finance Controls	<profile_fingerprint_sha256>
growth-marketing	marketing	Growth Marketing	<profile_fingerprint_sha256>
```

## 2) Initialize a profile

Installed CLI:

```bash
npx nooterra profile init engineering-spend --out ./profiles/engineering-spend.profile.json
```

Repo checkout:

```bash
./bin/nooterra.js profile init engineering-spend --out ./profiles/engineering-spend.profile.json
```

Example output:

```text
ok	engineering-spend	/home/you/repo/profiles/engineering-spend
```

## 3) Validate profile schema + semantics

Installed CLI:

```bash
npx nooterra profile validate ./profiles/engineering-spend.profile.json --format json
```

Repo checkout:

```bash
./bin/nooterra.js profile validate ./profiles/engineering-spend.profile.json --format json
```

Example output:

```json
{
  "schemaVersion": "NooterraProfileValidationReport.v1",
  "ok": true,
  "profileId": "engineering-spend",
  "profileFingerprintVersion": "NooterraProfileFingerprint.v1",
  "profileFingerprint": "<sha256>",
  "errors": [],
  "warnings": []
}
```

## 4) Simulate policy decisions

Installed CLI:

```bash
npx nooterra profile simulate ./profiles/engineering-spend.profile.json --format json
```

Repo checkout:

```bash
./bin/nooterra.js profile simulate ./profiles/engineering-spend.profile.json --format json
```

Example output:

```json
{
  "schemaVersion": "NooterraProfileSimulationReport.v1",
  "ok": true,
  "profileId": "engineering-spend",
  "decision": "allow",
  "requiredApprovers": 0,
  "approvalsProvided": 0,
  "selectedApprovalTier": "auto",
  "reasons": [],
  "reasonCodes": [],
  "reasonDetails": [],
  "reasonRegistryVersion": "NooterraProfileSimulationReasonRegistry.v1",
  "profileFingerprintVersion": "NooterraProfileFingerprint.v1",
  "profileFingerprint": "<sha256>"
}
```

To simulate with explicit scenario data:

```bash
./bin/nooterra.js profile simulate ./profiles/engineering-spend.profile.json --scenario ./test/fixtures/profile/scenario-allow.json --format json
```

## 5) Apply profile to runtime

Set runtime connection/auth values:

```bash
export NOOTERRA_BASE_URL=http://127.0.0.1:3000
export NOOTERRA_TENANT_ID=tenant_default
export NOOTERRA_API_KEY=sk_runtime_apply
# optional override:
export NOOTERRA_SPONSOR_WALLET_REF=wallet_ops_default
```

Dry-run first (no live writes):

```bash
./bin/nooterra.js profile apply ./profiles/engineering-spend.profile.json --dry-run --format json
```

Then execute live apply:

```bash
./bin/nooterra.js profile apply ./profiles/engineering-spend.profile.json --format json
```

`profile apply` also accepts runtime-prefixed aliases:
`NOOTERRA_RUNTIME_BASE_URL`, `NOOTERRA_RUNTIME_TENANT_ID`, `NOOTERRA_RUNTIME_BEARER_TOKEN`.

## Common troubleshooting

- `unknown profile`: run `nooterra profile list` and use one of the listed IDs.
- `validation failed`: fix reported schema/semantic errors, then rerun `profile validate`.
- `scenario file not found`: pass an existing JSON scenario path to `profile simulate`.
- `profile apply missing runtime config`: set runtime base URL, tenant ID, bearer token, and wallet ref before running live apply.
