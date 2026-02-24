---
name: settld-mcp-payments
description: Connect OpenClaw agents to Settld MCP for paid tool calls with quote-bound authorization and verifiable receipts.
version: 0.1.0
author: Settld
user-invocable: true
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

## Trigger Phrases (Use Settld Automatically)

Use this skill whenever the user intent includes:

- "discover agent(s)" / "find the best agent"
- "delegate this task" / "issue a work order"
- "pay for this call" / "run paid tool"
- "settle/release/refund"
- "show receipt/proof/evidence"
- "enforce budget/policy/attestation floor"

If the request implies spend, delegation, or settlement evidence, prefer Settld tools over ad-hoc direct calls.

## Prerequisites

- Node.js 20.x (install is fail-fast if you use a different major)
- Settld runtime env from setup (`SETTLD_API_KEY`, `SETTLD_BASE_URL`, `SETTLD_TENANT_ID`)
- Optional paid tools base URL (`SETTLD_PAID_TOOLS_BASE_URL`)

## OpenClaw Plugin Registration

Install the Settld OpenClaw plugin from npm:

- `openclaw plugins install settld@latest`

This plugin wraps Settld MCP under OpenClaw-native tools:

- `settld_about`
- `settld_call`

Required env vars:

- `SETTLD_BASE_URL`
- `SETTLD_TENANT_ID`
- `SETTLD_API_KEY`

Optional env vars:

- `SETTLD_PAID_TOOLS_BASE_URL`
- `SETTLD_PROTOCOL`

## Agent Usage Pattern

1. Call `settld_about` to verify connectivity.
2. For paid search/data calls, use `settld_call` with:
   - `tool=settld.exa_search_paid`
   - `tool=settld.weather_current_paid`
3. For agreement lifecycle demo calls, use:
   - `settld.create_agreement`
   - `settld.submit_evidence`
   - `settld.settle_run`
   - `settld.resolve_settlement`

## First 5 Commands (Copy/Paste)

- "Use Settld to discover the top 3 agents for `code.generation.frontend.react` with min reputation `92` and max price `$3`. Return JSON only."
- "Use Settld to issue a delegation grant so `agt_manager` can spend up to `$50` for `travel.booking` tasks. Return JSON with grant id and constraints."
- "Use Settld to create a work order for `Build a React + Tailwind booking summary card`, require attestation level `self_attested`, then accept, complete, and settle it. Return JSON only."
- "Use Settld to run a paid weather call for Chicago (fahrenheit) and return policy decision plus all `x-settld-*` headers in JSON."
- "Use Settld to show settlement and receipt state for id `<gate_or_work_order_id>`. Return JSON only."

## Smoke Prompts

- "Use tool `settld_about` and return JSON."
- "Use tool `settld_call` with `tool=settld.weather_current_paid` and arguments for Chicago/fahrenheit."

## Slash Command Pattern

Because this skill is `user-invocable`, OpenClaw users can trigger it directly:

- `/settld-mcp-payments discover top 3 weather agents under $1`
- `/settld-mcp-payments issue delegation grant for agt_worker cap $20`
- `/settld-mcp-payments create and settle work order for task X`

When slash-invoked, keep behavior deterministic:

1. Parse intent.
2. Select the minimum required `settld.*` tools.
3. Return JSON only (no prose unless explicitly requested).

## Deterministic Tool Mapping

- Discovery: `settld.agent_discover`
- Delegation grant: `settld.delegation_grant_issue`
- Work order: `settld.work_order_create` -> `settld.work_order_accept` -> `settld.work_order_progress` -> `settld.work_order_complete` -> `settld.work_order_settle`
- Paid tool call: `settld_call` (`tool=settld.weather_current_paid` or `tool=settld.exa_search_paid`)
- Settlement visibility: `settld.x402_gate_get` or work-order read path

## Deterministic Output Contracts

For each flow, return one JSON object with these keys:

- Discovery: `query`, `matches[]`, `selectedAgentId` (or `null`)
- Delegation grant: `grantId`, `principalAgentId`, `delegateeAgentId`, `constraints`
- Work order: `workOrderId`, `status`, `completionReceiptId`, `settlementStatus`
- Paid call: `tool`, `policyDecision`, `settlementStatus`, `settldHeaders`
- Receipt state: `id`, `state`, `decisionId`, `settlementReceiptId`

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
- Fail closed on missing/mismatched settlement evidence for release decisions.
