# Settld — Trust & Settlement OS for Agent Actions

[![CI](https://github.com/aidenlippert/settld/actions/workflows/tests.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/settld)](https://www.npmjs.com/package/settld)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node 22.x](https://img.shields.io/badge/node-22.x-brightgreen)](./.nvmrc)

Settld is a deterministic trust-and-settlement control plane for agent actions: **decision** (`allow|challenge|deny|escalate`) + **execution binding** + **verifiable receipts** + **recourse**.

Current wedge: an x402-style gateway that turns `HTTP 402` into `hold -> verify -> release/refund`, with deterministic receipts.

Docs: [Docs home](./docs/gitbook/README.md) · [Quickstart](./docs/gitbook/quickstart.md) · [Architecture](./docs/ARCHITECTURE.md) · [Public Specs](./docs/spec/public/README.md) · [Security model](./docs/gitbook/security-model.md) · [Security policy](./SECURITY.md) · [Support](./SUPPORT.md)

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

## Who It’s For

- Agent builders who want safe spend, receipts, and recourse (not “send money and pray”)
- Tool/API providers who want verifiable, pay-per-action access for agents
- Agent hosts/runtimes integrating a deterministic settlement + policy plane (OpenClaw, Codex, Claude Desktop, Cursor)
- Marketplace/coordination systems that need delegations + work orders + receipts as a contract

## What You Can Build

- Paid MCP tool calls with verify-before-release settlement (x402-style)
- A policy gate for paid/high-risk actions (`allow|challenge|deny|escalate`) with reason codes
- Inter-agent delegation + paid work orders with signed completion receipts
- Open discovery: publish `AgentCard.v1`, discover by capability/runtime/trust/attestation
- “Settld Verified” conformance gates that produce audit-grade artifacts

## Safety Model (Summary)

- Fail-closed by default for paid/high-risk actions (policy gate)
- Request/response binding + strict evidence requirements for release decisions
- Deterministic, verifiable receipts (canonical hashes + signatures where configured)
- Idempotency/retry discipline to prevent duplicate external side effects
- Recourse primitives are first-class (hold/release/refund/dispute/arbitration)

## Get Started (Local x402 Demo)

Prereqs: Node.js 22.x (LTS). Node.js 20.x is also supported, but OpenClaw requires Node >= 22.

```sh
nvm use
npm ci
npm run quickstart:x402
```

Note: if you see Node warnings like `ExperimentalWarning: CommonJS module ... is loading ES Module ...`, you are likely running an unsupported Node major (ex: Node 23). Use Node 22.x (LTS) for deterministic behavior.

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

Full guide: [docs/OPEN_DISCOVERY.md](./docs/OPEN_DISCOVERY.md)

Quick examples (repo checkout):

```sh
./bin/settld.js agent publish --help
./bin/settld.js agent discover --help
```

Note: public listing may require a refundable `ListingBond.v1` (anti-abuse). See the guide above.

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

Start at `docs/gitbook/README.md` (docs home), `docs/gitbook/quickstart.md` (first run), and `docs/QUICKSTART_MCP_HOSTS.md` (host onboarding).

Public protocol/spec contracts live in `docs/spec/` (especially `docs/spec/public/`).

## Contributing

See: [CONTRIBUTING.md](./CONTRIBUTING.md)
