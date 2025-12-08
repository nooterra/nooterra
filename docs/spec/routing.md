# Agent Routing Overview (v0.1)

This document describes how the coordinator selects agents for a given workflow node and how the canonical AgentCard is used in that process.

## Inputs to Routing

For each node:
- `capabilityId` (required)
- `workflowId` / `nodeName`
- Budget and policy constraints (from workflow/mandate)
- Candidate agents with:
  - Recent reputation / availability
  - Canonical `AgentRoutingProfile` (derived from `agents.agent_card`)

## AgentRoutingProfile

The coordinator derives a routing profile per agent:
- `did`
- `endpoint`
- `capabilityIds` (capabilities this agent declares)
- `acceptedPolicyIds`
- `regionsAllow` / `regionsDeny`
- `modelHint`
- `defaultPriceCents` / `defaultCurrency`
- `reputationScore` / `stakedAmount`
- `supportsVerification` (e.g. can act as a verifier)

Profiles are built from the canonical `agent_card` and are the long‑term surface the router should consume.

## Legacy vs Canonical Routing

There are two routing modes:

1. **Legacy mode (default)**  
   - Candidate selection uses `capabilities` + reputation/availability columns.
   - `AgentRoutingProfile` is computed in shadow and logged, but does not change behavior.

2. **Canonical AgentCard mode**  
   - Controlled by `USE_AGENT_CARD_ROUTING` env var.
   - When `USE_AGENT_CARD_ROUTING=true` and a non‑empty card‑filtered set exists, routing uses the AgentCard‑derived candidates.
   - If anything fails or card data is missing, the coordinator falls back to legacy selection.

## Shadow Routing & Divergence Logging

Even in legacy mode the coordinator runs AgentCard‑based routing in shadow:
- For each dispatch, the coordinator computes:
  - `legacyTop` — the agent chosen by legacy logic.
  - `cardTop` — the agent that would have been chosen from the AgentRoutingProfile set.
  - `agrees` — whether both choices match.
- It logs a comparison event:
  - `routing: "agent_card_shadow"`
  - `workflowId`, `nodeId`, `capabilityId`
  - `legacyTop`, `cardTop`, `agrees`
  - `legacyCount`, `cardCount`

Operators can monitor these logs to understand how safe it is to flip canonical routing on.

## Activation Plan

1. Run with `USE_AGENT_CARD_ROUTING` unset/false and observe shadow logs for a period of time.
2. Once agreement rates are satisfactory and divergences are understood, set:
   - `USE_AGENT_CARD_ROUTING=true`
3. At that point, AgentCard‑based routing becomes primary, with legacy behavior as a fallback only.

