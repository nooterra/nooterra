# Settld — Trust & Settlement OS for Agent Actions

[![CI](https://github.com/aidenlippert/settld/actions/workflows/tests.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/tests.yml)
[![Settld Verified Collaboration](https://github.com/aidenlippert/settld/actions/workflows/settld-verified-collaboration.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/settld-verified-collaboration.yml)
[![Settld Verified Guardrails](https://github.com/aidenlippert/settld/actions/workflows/settld-verified-guardrails.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/settld-verified-guardrails.yml)
[![npm](https://img.shields.io/npm/v/settld)](https://www.npmjs.com/package/settld)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node 22 LTS / 20 supported](https://img.shields.io/badge/node-22%20LTS%20%7C%2020%20supported-brightgreen)](./.nvmrc)

Settld is a deterministic trust-and-settlement control plane for agent actions: **decision** (`allow|challenge|deny|escalate`) + **execution binding** + **verifiable receipts** + **recourse**.

Current wedge: an x402-style gateway that turns `HTTP 402` into `hold -> verify -> release/refund`, with deterministic receipts.

Docs: [Overview](./docs/OVERVIEW.md) · [Architecture](./docs/ARCHITECTURE.md) · [Docs Index](./docs/README.md) · [Public Specs](./docs/spec/public/README.md) · [Naming](./docs/NAMING.md) · [Security](./SECURITY.md) · [Support](./SUPPORT.md)

## Highlights

- Policy decisioning that fails closed by default (deny/challenge/escalate) for paid/high-risk actions
- x402 verify-before-release: `402 -> hold -> verify -> release/refund`
- Inter-agent delegation primitives: `AgentCard.v1` + `DelegationGrant.v1` + `SubAgentWorkOrder.v1` + `SubAgentCompletionReceipt.v1`
- MCP tool surface + OpenClaw ClawHub distribution
- “Settld Verified” gates: deterministic conformance, receipts, and incident-ready artifacts

## Get Started (Local x402 Demo)

Prereqs: Node.js 22 LTS recommended (`20.x` is supported).

```sh
nvm use
npm ci
npm run quickstart:x402
```

CI-friendly one-shot run:

```sh
SETTLD_QUICKSTART_KEEP_ALIVE=0 npm run quickstart:x402
```

Success: prints `OK`, a `gateId=...`, and a `gateStateUrl=...`.

## Preferred Setup (Agent Hosts)

Onboard an agent host (OpenClaw / Claude / Cursor / Codex), with guided wallet + policy setup:

```sh
npx -y settld setup
```

Internal naming uses ACS workstreams; host identifiers stay canonical for compatibility.

## OpenClaw (ClawHub Skill)

Install the published skill and let your agent use Settld in natural language:

```sh
npx -y clawhub@latest install settld-mcp-payments
```

Quick prompts:

- “Use Settld to run a paid tool call and show me the receipt.”
- “Use Settld to discover agents with capability X and create a work order under $Y.”

More: [OpenClaw Quickstart](./docs/integrations/openclaw/PUBLIC_QUICKSTART.md)

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

CI collaboration gate (with uploaded JSON report artifacts):

- [`.github/workflows/settld-verified-collaboration.yml`](./.github/workflows/settld-verified-collaboration.yml)
- report path: `artifacts/gates/settld-verified-collaboration-gate.json`

CI guardrails gate (with uploaded JSON report artifacts):

- [`.github/workflows/settld-verified-guardrails.yml`](./.github/workflows/settld-verified-guardrails.yml)
- report path: `artifacts/gates/settld-verified-guardrails-gate.json`

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
