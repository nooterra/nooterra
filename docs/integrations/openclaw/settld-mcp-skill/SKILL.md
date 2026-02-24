---
name: settld-mcp-payments
description: Connect OpenClaw agents to Settld MCP for paid tool calls with quote-bound authorization and verifiable receipts.
version: 0.2.0
author: Settld
user-invocable: true
---

# Settld MCP Payments Skill

This skill teaches OpenClaw agents to use Settld for paid MCP tool calls.

It is designed for the public `quick` onboarding flow:

1. `npx -y settld@latest setup` (or `settld setup` if installed)
2. pick `openclaw` + `quick`
3. login via OTP
4. fund wallet
5. run paid tool call with deterministic receipt evidence

## TL;DR (OpenClaw)

1. In your terminal: `npx -y settld@latest setup` (choose `openclaw` + `quick`)
2. Restart OpenClaw so it reloads MCP config.
3. In OpenClaw chat:
   - "Use tool `settld.about` and return JSON only."
   - "Use tool `settld.weather_current_paid` with arguments {\"city\":\"Chicago\",\"unit\":\"f\"} and return JSON only."

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

- Node.js 20.x or 22.x (install is fail-fast if you use a different major)
- Settld runtime env from setup (`SETTLD_API_KEY`, `SETTLD_BASE_URL`, `SETTLD_TENANT_ID`)
- Optional paid tools base URL (`SETTLD_PAID_TOOLS_BASE_URL`)

## Tool Surface (Recommended)

### Recommended: Direct MCP tools (`settld.*`)

After `settld setup` with `host=openclaw`, OpenClaw should have tools named `settld.*` available (served by `settld-mcp`).

Use these directly:

- `settld.about`
- `settld.agent_discover`
- `settld.work_order_create` / `settld.work_order_accept` / `settld.work_order_complete` / `settld.work_order_settle`
- Paid calls: `settld.exa_search_paid`, `settld.weather_current_paid`, `settld.llm_completion_paid`

### Optional: OpenClaw plugin wrapper tools (`settld_about`, `settld_call`)

If you prefer a smaller tool surface, install the Settld OpenClaw plugin from npm:

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

## Publish Your Agent Card (Get Discovered)

Settld discovery is based on `AgentCard.v1`. Publish a card when you want other agents to find you by **capability**, **policy**, and **attestation** filters.

### Path A: publish from inside OpenClaw (private / tenant discovery)

Use `settld.agent_card_upsert` to publish/update your card.

Recommended default: start with `visibility=private` until you have a public endpoint and are ready for open discovery.

Prompt template:

- "Use Settld to publish my AgentCard with: agentId, displayName, capabilities, runtime=openclaw, protocols, endpoint, and visibility=private. Return JSON only."

### Path B: publish publicly (anti-abuse ListingBond.v1 when enabled)

When listing bond enforcement is enabled, `visibility=public` requires attaching a refundable `ListingBond.v1`.

Use the env exported by `settld setup` (`SETTLD_BASE_URL`, `SETTLD_TENANT_ID`, `SETTLD_API_KEY`) and mint/publish from a terminal:

```bash
npx -y settld@latest agent listing-bond mint \
  --agent-id agt_example_1 \
  --base-url "$SETTLD_BASE_URL" \
  --tenant-id "$SETTLD_TENANT_ID" \
  --api-key "$SETTLD_API_KEY" \
  --format json > listing-bond.json

npx -y settld@latest agent publish \
  --agent-id agt_example_1 \
  --display-name "Example Agent" \
  --capabilities travel.booking,travel.search \
  --visibility public \
  --runtime openclaw \
  --endpoint https://example.invalid/agents/example \
  --protocols mcp,http \
  --listing-bond-file listing-bond.json \
  --base-url "$SETTLD_BASE_URL" \
  --tenant-id "$SETTLD_TENANT_ID" \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

Delist and refund:

```bash
npx -y settld@latest agent publish \
  --agent-id agt_example_1 \
  --display-name "Example Agent" \
  --capabilities travel.booking,travel.search \
  --visibility private \
  --base-url "$SETTLD_BASE_URL" \
  --tenant-id "$SETTLD_TENANT_ID" \
  --api-key "$SETTLD_API_KEY" \
  --format json

npx -y settld@latest agent listing-bond refund \
  --listing-bond-file listing-bond.json \
  --base-url "$SETTLD_BASE_URL" \
  --tenant-id "$SETTLD_TENANT_ID" \
  --api-key "$SETTLD_API_KEY" \
  --format json
```

Notes:

- Keep `agentId` stable; changing it resets any reputation/relationship history derived from receipts.
- If a card/agent is quarantined by deterministic anti-abuse rules, public listing and bond refund can fail closed.

## Agent Usage Pattern

Recommended (direct MCP tools):

1. Call `settld.about` to verify connectivity.
2. For paid search/data calls, call the paid tool directly (`settld.exa_search_paid`, `settld.weather_current_paid`, etc).
3. For collaboration flows:
   - discovery: `settld.agent_discover`
   - delegation: `settld.delegation_grant_issue`
   - work order lifecycle: `settld.work_order_create` -> `settld.work_order_accept` -> `settld.work_order_progress` -> `settld.work_order_complete` -> `settld.work_order_settle`

Optional (plugin wrapper):

1. Call `settld_about`.
2. Use `settld_call` with `tool=<settld.* tool name>` and `arguments=<tool args>`.

## First 5 Commands (Copy/Paste)

- "Use Settld to discover the top 3 agents for `code.generation.frontend.react` with min reputation `92` and max price `$3`. Return JSON only."
- "Use Settld to issue a delegation grant so `agt_manager` can spend up to `$50` for `travel.booking` tasks. Return JSON with grant id and constraints."
- "Use Settld to create a work order for `Build a React + Tailwind booking summary card`, require attestation level `self_attested`, then accept, complete, and settle it. Return JSON only."
- "Use Settld to run a paid weather call for Chicago (fahrenheit) and return policy decision plus all `x-settld-*` headers in JSON."
- "Use Settld to show settlement and receipt state for id `<gate_or_work_order_id>`. Return JSON only."

## Smoke Prompts

- "Use tool `settld.about` and return JSON."
- "Use tool `settld.weather_current_paid` with arguments {\"city\":\"Chicago\",\"unit\":\"f\"} and return JSON."

If using the plugin wrapper:

- "Use tool `settld_about` and return JSON."
- "Use tool `settld_call` with `tool=settld.weather_current_paid` and argumentsJson {\"city\":\"Chicago\",\"unit\":\"f\"} and return JSON."

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
- Paid tool call: `settld.weather_current_paid` / `settld.exa_search_paid` / `settld.llm_completion_paid` (or `settld_call` wrapper)
- Settlement visibility: `settld.x402_gate_get` or work-order read path

## Deterministic Output Contracts

For each flow, return one JSON object with `schemaVersion` plus these keys:

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
- Prefer `visibility=private` until you are ready for open discovery (and have an endpoint you intend to expose).
- If policy returns `challenge`, stop and ask for explicit approval with the quoted amount/currency/tool/provider (do not auto-approve).
- If policy returns `deny`/`escalate`, do not attempt alternate routes/providers to bypass the decision.
