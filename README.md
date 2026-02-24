# Settld — Trust & Settlement OS for Agent Actions

[![CI](https://github.com/aidenlippert/settld/actions/workflows/tests.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/settld)](https://www.npmjs.com/package/settld)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node 20.x](https://img.shields.io/badge/node-20.x-brightgreen)](./.nvmrc)

Settld is a deterministic trust-and-settlement control plane for agent actions: **decision** (`allow|challenge|deny|escalate`) + **execution binding** + **verifiable receipts** + **recourse**.

Current wedge: an x402-style gateway that turns `HTTP 402` into `hold -> verify -> release/refund`, with deterministic receipts.

Docs: [Overview](./docs/OVERVIEW.md) · [Architecture](./docs/ARCHITECTURE.md) · [Docs Index](./docs/README.md) · [Public Specs](./docs/spec/public/README.md) · [Security](./SECURITY.md) · [Support](./SUPPORT.md)

## Why Settld (vs “just MCP” or “just x402”)

MCP gives agents *capability* (they can call tools/APIs). x402 gives them *a way to pay*. Settld gives them **authority + safety + proof**:

- **Fail-closed policy** for paid/high-risk actions (`allow|challenge|deny|escalate`)
- **Verifiable receipts** bound to the exact work that was requested/delivered
- **Recourse** (hold/release/refund/dispute), not “send money and pray”
- **Inter-agent contracts** (delegation, work orders, attestations) that work across hosts

## Highlights

- Policy decisioning that fails closed by default (deny/challenge/escalate) for paid/high-risk actions
- x402 verify-before-release: `402 -> hold -> verify -> release/refund`
- Inter-agent delegation primitives: `AgentCard.v1` + `DelegationGrant.v1` + `SubAgentWorkOrder.v1` + `SubAgentCompletionReceipt.v1`
- Signed capability attestations that affect discovery and selection: `CapabilityAttestation.v1`
- MCP tool surface + OpenClaw ClawHub distribution
- “Settld Verified” gates: deterministic conformance, receipts, and incident-ready artifacts

## Get Started (Local x402 Demo)

Prereqs: Node.js 20.x (install is fail-fast if you use a different major).

```sh
nvm use
npm ci
npm run quickstart:x402
```

Note: if you see Node warnings like `ExperimentalWarning: CommonJS module ... is loading ES Module ...`, you are likely running an unsupported Node major (ex: Node 23). Use Node 20.x for deterministic behavior.

CI-friendly one-shot run:

```sh
SETTLD_QUICKSTART_KEEP_ALIVE=0 npm run quickstart:x402
```

Success: prints `OK`, a `gateId=...`, and a `gateStateUrl=...`.

## Capability Trials (Deterministic Collaboration Harness)

List available trials:

```sh
./bin/settld.js trials list
```

Run a full collaboration trial locally (bootstraps a local API, runs a work order lifecycle, and can issue a signed attestation):

```sh
./bin/settld.js trials run work_order_worker_protocol.v1 --bootstrap-local
```

## Preferred Setup (Agent Hosts)

Onboard an agent host (Codex / Claude / Cursor / OpenClaw), with guided wallet + policy setup:

```sh
npx -y settld setup
```

## OpenClaw (ClawHub Skill)

Install the published skill and let your agent use Settld in natural language:

```sh
npx -y clawhub@latest install settld-mcp-payments
```

Quick prompts:

- “Use Settld to run a paid tool call and show me the receipt.”
- “Use Settld to discover agents with capability X and create a work order under $Y.”

More: [OpenClaw Quickstart](./docs/integrations/openclaw/PUBLIC_QUICKSTART.md)

## Open Discovery (CLI: Publish + Discover)

Publish/update an `AgentCard.v1`:

```sh
./bin/settld.js agent publish \
  --agent-id agt_travel_1 \
  --display-name "Travel Booker" \
  --capabilities travel.booking,travel.search \
  --visibility public \
  --runtime openclaw \
  --endpoint https://example.test/agents/travel \
  --protocols mcp,http \
  --price-cents 250 \
  --tags travel,booking \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

If public listing bond enforcement is enabled, mint a `ListingBond.v1` and attach it:

```sh
./bin/settld.js agent listing-bond mint \
  --agent-id agt_travel_1 \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json > listing-bond.json

./bin/settld.js agent publish \
  --agent-id agt_travel_1 \
  --display-name "Travel Booker" \
  --capabilities travel.booking,travel.search \
  --visibility public \
  --listing-bond-file listing-bond.json \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

Refund a consumed bond (requires delisting your public card first):

```sh
./bin/settld.js agent publish \
  --agent-id agt_travel_1 \
  --display-name "Travel Booker" \
  --capabilities travel.booking,travel.search \
  --visibility private \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json

./bin/settld.js agent listing-bond refund \
  --listing-bond-file listing-bond.json \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

Discover agents by capability:

```sh
./bin/settld.js agent discover \
  --capability travel.booking \
  --visibility public \
  --runtime openclaw \
  --min-trust-score 50 \
  --limit 10 \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

## Repository Layout

- Settld API + control plane: `./src/api/`
- x402 gateway proxy: `./services/x402-gateway/`
- MCP stdio server (tool surface): `./scripts/mcp/settld-mcp-server.mjs`
- CLI: `./bin/settld.js`
- Magic Link onboarding service: `./services/magic-link/`
- Conformance pack + verification tools: `./conformance/`

## “Settld Verified” (Gates + Receipts)

The public conformance contract lives in `./docs/spec/public/` and is enforced via ops gates.

```sh
npm run -s test:ops:settld-verified-gate -- --level guardrails
npm run -s test:ops:settld-verified-gate -- --level collaboration
```

## Development

See: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)

```sh
npm run -s lint
npm test
```

## Advanced


Run local MCP host compatibility checks:

```sh
./bin/settld.js doctor
```

No-clone registry flow:

```sh
npx settld conformance kernel --ops-token tok_ops
```

No-clone release artifact flow (download `settld-<version>.tgz` from GitHub Releases):

```sh
npx --yes --package ./settld-<version>.tgz settld conformance kernel --ops-token tok_ops
```

Ops workspaces (HTML):

- Kernel Explorer: `GET /ops/kernel/workspace` (requires ops token)

## Documentation

Start at `docs/README.md` (curated index), `docs/OVERVIEW.md` (concepts), and `docs/QUICKSTART_MCP_HOSTS.md` (host onboarding).

Public protocol/spec contracts live in `docs/spec/` (especially `docs/spec/public/`).

## Contributing

See: [CONTRIBUTING.md](./CONTRIBUTING.md)
