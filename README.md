# Nooterra — Neutral Action Layer for Consequential AI

[![CI](https://github.com/nooterra/nooterra/actions/workflows/tests.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/tests.yml)
[![Nooterra Verified Collaboration](https://github.com/nooterra/nooterra/actions/workflows/nooterra-verified-collaboration.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/nooterra-verified-collaboration.yml)
[![Nooterra Verified Guardrails](https://github.com/nooterra/nooterra/actions/workflows/nooterra-verified-guardrails.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/nooterra-verified-guardrails.yml)
[![npm](https://img.shields.io/npm/v/nooterra)](https://www.npmjs.com/package/nooterra)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node 22 LTS / 20 supported](https://img.shields.io/badge/node-22%20LTS%20%7C%2020%20supported-brightgreen)](./.nvmrc)

Nooterra is the **Action Wallet** and run-contract layer for consequential AI actions.
External agent hosts can plan anywhere, but hosted approvals, scoped execution grants, receipts, settlement, and recourse flow through Nooterra before real-world side effects happen.
The first release is one API for hosts plus one hosted approval and receipt app for users.

Launch v1 is locked to `buy` and `cancel/recover` through `Claude MCP` and `OpenClaw`, backed by deterministic envelopes, approval records, and fail-closed execution.
Hosts remain the executors in v1; Nooterra does not own last-mile execution at launch.
Out of scope for launch: booking/rebooking, Nooterra-owned last-mile execution, certified execution adapters and browser fallback, a first-party assistant shell, ChatGPT app packaging, enterprise connectors, and an open marketplace.

Docs: [Overview](./docs/OVERVIEW.md) · [Architecture](./docs/ARCHITECTURE.md) · [Docs Index](./docs/README.md) · [Public Specs](./docs/spec/public/README.md) · [Naming](./docs/NAMING.md) · [Security](./SECURITY.md) · [Support](./SUPPORT.md)

## Highlights

- Neutral approval wallet for consequential AI actions
- Hosted approvals, scoped grants, receipts, disputes, and operator rescue for host-run actions
- API for builders plus approval and receipt UI for users
- No Nooterra-owned last-mile execution path in v1
- Fail-closed authority, evidence, settlement, and dispute substrate
- Public action-intent and execution-grant aliases over deterministic kernel objects
- MCP tool surface + hosted approval links + OpenClaw packaging
- “Nooterra Verified” gates: deterministic conformance, receipts, and incident-ready artifacts

## Get Started (Launch Channels)

Prereqs: Node.js 22 LTS recommended (`20.x` is supported).

```sh
nvm use
npm ci
npx -y nooterra setup
```

This installs the host-first Action Wallet flow for supported launch channels and sets up the hosted approval surface.

## Preferred Setup (Agent Hosts)

Onboard an agent host (OpenClaw / Claude / Cursor / local MCP runtime) with guided wallet + policy setup:

```sh
npx -y nooterra setup
```

Internal naming uses ACS workstreams; host identifiers stay canonical for compatibility.

## OpenClaw (ClawHub Skill)

Install the published skill and let your agent use Nooterra in natural language:

```sh
npx -y clawhub@latest install nooterra-mcp-payments
```

Quick prompts:

- “Use Nooterra to create an action intent and request approval.”
- “Use Nooterra to finalize the action and show me the receipt.”

More: [OpenClaw Quickstart](./docs/integrations/openclaw/PUBLIC_QUICKSTART.md)

## Repository Layout

- Nooterra API + Action Wallet control plane: `./src/api/`
- x402 gateway proxy: `./services/x402-gateway/`
- MCP stdio server (tool surface): `./scripts/mcp/nooterra-mcp-server.mjs`
- CLI: `./bin/nooterra.js`
- Magic Link onboarding service: `./services/magic-link/`
- Conformance pack + verification tools: `./conformance/`
- Agentverse bridge API wrappers: `./src/agentverse/bridge/`

## Agentverse Bridge Wrappers

```sh
node --input-type=module -e "await import('./src/agentverse/bridge/index.js'); await import('./src/agentverse/index.js');"
npm run -s test:ops:agentverse-gate
```

## “Nooterra Verified” (Gates + Receipts)

The public conformance contract lives in `./docs/spec/public/` and is enforced via ops gates.

```sh
npm run -s test:ops:nooterra-verified-gate -- --level guardrails
npm run -s test:ops:nooterra-verified-gate -- --level collaboration
```

CI collaboration gate (with uploaded JSON report artifacts):

- [`.github/workflows/nooterra-verified-collaboration.yml`](./.github/workflows/nooterra-verified-collaboration.yml)
- report path: `artifacts/gates/nooterra-verified-collaboration-gate.json`

CI guardrails gate (with uploaded JSON report artifacts):

- [`.github/workflows/nooterra-verified-guardrails.yml`](./.github/workflows/nooterra-verified-guardrails.yml)
- report path: `artifacts/gates/nooterra-verified-guardrails-gate.json`

## Development

See: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)

```sh
npm run -s lint
npm test
```

## Advanced


Run local MCP host compatibility checks:

```sh
./bin/nooterra.js doctor
```

No-clone registry flow:

```sh
npx nooterra conformance kernel --ops-token tok_ops
```

No-clone release artifact flow (download `nooterra-<version>.tgz` from GitHub Releases):

```sh
npx --yes --package ./nooterra-<version>.tgz nooterra conformance kernel --ops-token tok_ops
```

Ops workspaces (HTML):

- Kernel Explorer: `GET /ops/kernel/workspace` (requires ops token)

## Documentation

Start at `docs/README.md` (curated index), `docs/OVERVIEW.md` (concepts), and `docs/QUICKSTART_MCP_HOSTS.md` (host onboarding).

Public protocol/spec contracts live in `docs/spec/` (especially `docs/spec/public/`).

## Contributing

See: [CONTRIBUTING.md](./CONTRIBUTING.md)
