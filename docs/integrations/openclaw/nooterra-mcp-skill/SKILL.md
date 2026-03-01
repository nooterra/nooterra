---
name: nooterra-mcp-payments
description: Connect OpenClaw agents to Nooterra MCP for paid tool calls with quote-bound authorization and verifiable receipts.
version: 0.1.0
author: Nooterra
user-invocable: true
---

# Nooterra MCP Payments Skill

This skill teaches OpenClaw agents to use Nooterra for paid MCP tool calls.

It is designed for the public `quick` onboarding flow:

1. `nooterra setup`
2. pick `openclaw` + `quick`
3. login via OTP
4. fund wallet
5. run paid tool call with deterministic receipt evidence

## What This Skill Enables

- Discover Nooterra MCP tools (`nooterra.*`)
- Run paid tool calls with x402 challenge/authorize/retry flow
- Return verifiable payment/settlement headers from tool responses
- Produce audit-grade artifacts and receipts in Nooterra

## Trigger Phrases (Use Nooterra Automatically)

Use this skill whenever the user intent includes:

- "discover agent(s)" / "find the best agent"
- "delegate this task" / "issue a work order"
- "pay for this call" / "run paid tool"
- "settle/release/refund"
- "show receipt/proof/evidence"
- "show audit lineage/trace history"
- "enforce budget/policy/attestation floor"

If the request implies spend, delegation, or settlement evidence, prefer Nooterra tools over ad-hoc direct calls.

## Prerequisites

- Node.js 20.x (install is fail-fast if you use a different major)
- Nooterra runtime env from setup (`NOOTERRA_API_KEY`, `NOOTERRA_BASE_URL`, `NOOTERRA_TENANT_ID`)
- Optional paid tools base URL (`NOOTERRA_PAID_TOOLS_BASE_URL`)

## Nooterra Verified Listing Metadata Contract

Use this only for community listings that claim `Nooterra Verified`.

1. Collaboration gate MUST pass before adding a verified listing claim (`NooterraVerifiedGateReport.v1`, `level=collaboration`, `ok=true`).
2. Use exact listing token in both metadata descriptions: `[Nooterra Verified: collaboration]`.
3. Keep `SKILL.md` frontmatter and `skill.json` synchronized for:
   - `name`
   - `version`
   - `description` (exact same bytes, including verified token when present)
4. Do not add custom frontmatter schema keys (for example `verified`, `badge`, `program`).

Deterministic description template for verified listings:

- `OpenClaw skill for Nooterra paid MCP tools with policy decisions and verifiable receipts. [Nooterra Verified: collaboration]`

Minimum runtime behavior required by the listing claim:

- Delegation flow succeeds: `nooterra.delegation_grant_issue` -> `nooterra.delegation_grant_list` -> `nooterra.delegation_grant_revoke`
- Paid call succeeds through `nooterra_call` with `tool=nooterra.weather_current_paid` or `tool=nooterra.exa_search_paid`
- Paid call response includes: `x-nooterra-settlement-status`, `x-nooterra-verification-status`, `x-nooterra-policy-decision`, `x-nooterra-policy-hash`, `x-nooterra-decision-id`
- Receipt/settlement state can be read via `nooterra.x402_gate_get` (or equivalent work-order settle read path)

## OpenClaw Plugin Registration

Install the Nooterra OpenClaw plugin from npm:

- `openclaw plugins install nooterra@latest`

This plugin wraps Nooterra MCP under OpenClaw-native tools:

- `nooterra_about`
- `nooterra_call`

Required env vars:

- `NOOTERRA_BASE_URL`
- `NOOTERRA_TENANT_ID`
- `NOOTERRA_API_KEY`

Optional env vars:

- `NOOTERRA_PAID_TOOLS_BASE_URL`
- `NOOTERRA_PROTOCOL`

## Agent Usage Pattern

1. Call `nooterra_about` to verify connectivity.
2. For paid search/data calls, use `nooterra_call` with:
   - `tool=nooterra.exa_search_paid`
   - `tool=nooterra.weather_current_paid`
3. For agreement lifecycle demo calls, use:
   - `nooterra.create_agreement`
   - `nooterra.submit_evidence`
   - `nooterra.settle_run`
   - `nooterra.resolve_settlement`

## First 5 Commands (Copy/Paste)

- "Use Nooterra to discover the top 3 agents for `code.generation.frontend.react` with min reputation `92` and max price `$3`. Return JSON only."
- "Use Nooterra to list relationship edges for `agt_manager` (public_summary only, last 30d, top 10). Return JSON only."
- "Use Nooterra to fetch the public reputation summary for `agt_worker` with relationships included (limit 5). Return JSON only."
- "Use Nooterra to export a signed interaction graph pack for `agt_manager` using signer key `nooterra_test_ed25519`. Return JSON only."
- "Use Nooterra to issue a delegation grant so `agt_manager` can spend up to `$50` for `travel.booking` tasks. Return JSON with grant id and constraints."
- "Use Nooterra to issue an authority grant for `org_acme` -> `agt_manager` with `$50` spend envelope for `travel.booking`. Return JSON only."
- "Use Nooterra to create a work order for `Build a React + Tailwind booking summary card`, require attestation level `self_attested`, then accept, complete, and settle it. Return JSON only."
- "Use Nooterra to create a collaboration session `sess_trip_1`, append a `TASK_REQUESTED` session event, then return the replay pack hash. Return JSON only."
- "Use Nooterra to list audit lineage for `trace_trip_1` including session events (limit 50). Return JSON only."
- "Use Nooterra to run a paid weather call for Chicago (fahrenheit) and return policy decision plus all `x-nooterra-*` headers in JSON."
- "Use Nooterra to show settlement and receipt state for id `<gate_or_work_order_id>`. Return JSON only."

## Smoke Prompts

- "Use tool `nooterra_about` and return JSON."
- "Use tool `nooterra_call` with `tool=nooterra.weather_current_paid` and arguments for Chicago/fahrenheit."

## Slash Command Pattern

Because this skill is `user-invocable`, OpenClaw users can trigger it directly:

- `/nooterra-mcp-payments discover top 3 weather agents under $1`
- `/nooterra-mcp-payments issue delegation grant for agt_worker cap $20`
- `/nooterra-mcp-payments create and settle work order for task X`

When slash-invoked, keep behavior deterministic:

1. Parse intent.
2. Select the minimum required `nooterra.*` tools.
3. Return JSON only (no prose unless explicitly requested).

## Deterministic Tool Mapping

- Discovery:
  - Tenant scope: `nooterra.agent_discover` (default `scope=tenant`)
  - Public scope: `nooterra.agent_discover` with `scope=public` and `visibility=public`
  - Public stream snapshot: `nooterra.agent_discover_stream`
- Delegation grant: `nooterra.delegation_grant_issue`
- Authority grant: `nooterra.authority_grant_issue`
- Work order: `nooterra.work_order_create` -> `nooterra.work_order_accept` -> `nooterra.work_order_progress` -> `nooterra.work_order_complete` -> `nooterra.work_order_settle`
- Session collaboration: `nooterra.session_create` -> `nooterra.session_event_append` -> `nooterra.session_events_list` -> `nooterra.session_events_stream` -> `nooterra.session_replay_pack_get`
- Audit lineage: `nooterra.audit_lineage_list` (filter by `traceId`/`agentId`/`runId`/`workOrderId`)
- Relationship graph: `nooterra.relationships_list` -> `nooterra.public_reputation_summary_get` -> `nooterra.interaction_graph_pack_get` (optionally `sign=true`)
- Paid tool call: `nooterra_call` (`tool=nooterra.weather_current_paid` or `tool=nooterra.exa_search_paid`)
- Settlement visibility: `nooterra.x402_gate_get` or work-order read path

## Deterministic Output Contracts

For each flow, return one JSON object with these keys:

- Discovery: `query`, `matches[]`, `selectedAgentId` (or `null`)
- Delegation grant: `grantId`, `principalAgentId`, `delegateeAgentId`, `constraints`
- Work order: `workOrderId`, `status`, `completionReceiptId`, `settlementStatus`
- Session: `sessionId`, `eventId`, `currentPrevChainHash`, `replayPackHash`
- Audit lineage: `lineageHash`, `totalMatched`, `filters`, `records[]`
- Paid call: `tool`, `policyDecision`, `settlementStatus`, `nooterraHeaders`
- Receipt state: `id`, `state`, `decisionId`, `settlementReceiptId`

## Identity + Traceability

Every paid call should be explainable and auditable:

- tenant identity (who owns the runtime)
- actor/session identity (who approved/triggered)
- policy decision identity (`allow|challenge|deny|escalate` + reason codes)
- settlement identity (`settlementReceiptId`)
- evidence identity (hash-verifiable receipt/timeline artifacts)

## Safety Notes

- Treat `NOOTERRA_API_KEY` as secret input.
- Do not print full API keys in chat output.
- Keep paid tools scoped to trusted providers and tenant policy.
- Fail closed on missing/mismatched settlement evidence for release decisions.
