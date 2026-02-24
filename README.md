# Settld — Trust & Settlement OS for Agent Actions

[![CI](https://github.com/aidenlippert/settld/actions/workflows/tests.yml/badge.svg)](https://github.com/aidenlippert/settld/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/settld)](https://www.npmjs.com/package/settld)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node 20.x](https://img.shields.io/badge/node-20.x-brightgreen)](./.nvmrc)

Settld is a deterministic trust-and-settlement control plane for agent actions: **decision** (`allow|challenge|deny|escalate`) + **execution binding** + **verifiable receipts** + **recourse**.

Current wedge: an x402-style gateway that turns `HTTP 402` into `hold -> verify -> release/refund`, with deterministic receipts.

Docs: [Overview](./docs/OVERVIEW.md) · [Architecture](./docs/ARCHITECTURE.md) · [x402 Quickstart](./docs/QUICKSTART_X402_GATEWAY.md) · [MCP Hosts](./docs/QUICKSTART_MCP_HOSTS.md) · [Public Specs](./docs/spec/public/README.md) · [Security](./SECURITY.md) · [Support](./docs/SUPPORT.md)

## Get Started (Local x402 Demo)

Prereqs: Node.js 20.x (install is fail-fast if you use a different major).

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

## What’s In This Repo

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

## Contributing

See: [CONTRIBUTING.md](./CONTRIBUTING.md)


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

## Docs

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/JOB_STATE_MACHINE.md`
- `docs/EVENT_ENVELOPE.md`
- `docs/ACCESS.md`
- `docs/SKILLS.md`
- `docs/TRUST.md`
- `docs/LEDGER.md`
- `docs/SKILL_BUNDLE_FORMAT.md`
- `docs/CERTIFICATION_CHECKLIST.md`
- `docs/THREAT_MODEL.md`
- `docs/INCIDENT_TAXONOMY.md`
- `docs/ONCALL_PLAYBOOK.md`
- `docs/MVP_BUILD_ORDER.md`
- `docs/QUICKSTART_VERIFY.md`
- `docs/QUICKSTART_PRODUCE.md`
- `docs/QUICKSTART_SDK.md`
- `docs/QUICKSTART_SDK_PYTHON.md`
- `docs/QUICKSTART_POLICY_PACKS.md`
- `docs/QUICKSTART_MCP.md`
- `docs/QUICKSTART_MCP_HOSTS.md`
- `docs/ADOPTION_CHECKLIST.md`
- `docs/SUPPORT.md`
- `docs/OPERATIONS_SIGNING.md`
- `docs/KERNEL_V0.md`
- `docs/KERNEL_COMPATIBLE.md`
- `docs/ops/PAYMENTS_ALPHA_R5.md`
- `docs/ops/X402_PILOT_WEEKLY_METRICS.md`
- `docs/ops/ARTIFACT_VERIFICATION_STATUS.md`
- `docs/ops/TRUST_CONFIG_WIZARD.md`
- `docs/integrations/README.md`
