---
name: settld-mcp-payments
description: Connect OpenClaw agents to Settld MCP for paid tool calls with quote-bound authorization and verifiable receipts.
version: 0.1.0
author: Settld
---

# Settld MCP Payments Skill

This skill teaches OpenClaw agents to use Settld for paid MCP tool calls.

It is designed for the public `quick` onboarding flow:

1. `settld setup`
2. pick `openclaw` + `quick`
3. login via OTP
4. fund wallet
5. run paid tool call with deterministic receipt evidence

## What This Skill Enables

- Discover Settld MCP tools (`settld.*`)
- Run paid tool calls with x402 challenge/authorize/retry flow
- Return verifiable payment/settlement headers from tool responses
- Produce audit-grade artifacts and receipts in Settld

## Prerequisites

- Node.js 20+
- Settld runtime env from setup (`SETTLD_API_KEY`, `SETTLD_BASE_URL`, `SETTLD_TENANT_ID`)
- Optional paid tools base URL (`SETTLD_PAID_TOOLS_BASE_URL`)

## MCP Server Registration

Use the server definition in `mcp-server.example.json`.

Server command:

- command: `npx`
- args: `["-y","settld-mcp"]`

Required env vars:

- `SETTLD_BASE_URL`
- `SETTLD_TENANT_ID`
- `SETTLD_API_KEY`

Optional env vars:

- `SETTLD_PAID_TOOLS_BASE_URL`
- `SETTLD_PROTOCOL`

## Agent Usage Pattern

1. Call `settld.about` to verify connectivity.
2. For paid search/data calls, use:
   - `settld.exa_search_paid`
   - `settld.weather_current_paid`
3. For agreement lifecycle demo calls, use:
   - `settld.create_agreement`
   - `settld.submit_evidence`
   - `settld.settle_run`
   - `settld.resolve_settlement`

## Smoke Prompts

- "Call `settld.about` and return the result JSON."
- "Run `settld.weather_current_paid` for Chicago in fahrenheit and include the `x-settld-*` headers."

## Identity + Traceability

Every paid call should be explainable and auditable:

- tenant identity (who owns the runtime)
- actor/session identity (who approved/triggered)
- policy decision identity (`allow|challenge|deny|escalate` + reason codes)
- settlement identity (`settlementReceiptId`)
- evidence identity (hash-verifiable receipt/timeline artifacts)

## Safety Notes

- Treat `SETTLD_API_KEY` as secret input.
- Do not print full API keys in chat output.
- Keep paid tools scoped to trusted providers and tenant policy.
