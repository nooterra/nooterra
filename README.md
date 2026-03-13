# Nooterra

[![CI](https://github.com/nooterra/nooterra/actions/workflows/tests.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/nooterra)](https://www.npmjs.com/package/nooterra)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

Nooterra builds **Action Wallets for AI agents**.

An Action Wallet gives an agent programmable authority to take real actions under explicit limits, approvals, receipts, and recourse. Instead of giving an agent unchecked permissions, teams give it a Nooterra runtime that can request approval, receive a scoped execution grant, and leave a deterministic receipt when the action is done.

## What It Does

- Hosted approvals for consequential machine action
- Scoped execution grants instead of open-ended permissions
- Receipts and disputes for real-world actions
- One runtime contract across Claude MCP, OpenClaw, Codex, CLI, and API
- Fail-closed control paths for high-risk actions

## Current Launch Scope

Launch v1 is focused on:

- `buy`
- `cancel/recover`
- `Claude MCP`
- `OpenClaw`

Hosts remain the executors in v1. Nooterra governs the action boundary, approval flow, and receipt/dispute lifecycle.

## Get Started

Prereqs: Node.js 22 LTS recommended (`20.x` supported).

```sh
nvm use
npm ci
npx -y nooterra setup
```

Quick links:

- [Website](https://www.nooterra.ai)
- [Docs home](./docs/README.md)
- [Host quickstart](./docs/QUICKSTART_MCP_HOSTS.md)
- [OpenClaw quickstart](./docs/integrations/openclaw/PUBLIC_QUICKSTART.md)
- [Security](./SECURITY.md)
- [Support](./SUPPORT.md)

## Repository Layout

- API and Action Wallet runtime: `./src/api/`
- Hosted onboarding/auth service: `./services/magic-link/`
- CLI: `./bin/nooterra.js`
- MCP server: `./scripts/mcp/nooterra-mcp-server.mjs`
- Dashboard and public site: `./dashboard/`
- Docs: `./docs/`
- Tests: `./test/`

## Development

```sh
npm run -s lint
npm test
```

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for local development details.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
