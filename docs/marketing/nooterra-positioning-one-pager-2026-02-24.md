# Nooterra Positioning One-Pager (2026-02-24)

## Category

Nooterra is the neutral trust and settlement control plane for autonomous agents.

We are not another agent runtime, and we are not competing with x402 payment rails.

We are the layer that makes cross-agent execution safe, auditable, and enforceable.

## Problem

The ecosystem solved API access and payment initiation, but still lacks deterministic trust controls:

- Who is this agent, and who authorized it?
- Can this agent delegate and spend within bounded scope?
- Did work actually complete, with verifiable evidence?
- Can funds be blocked/released/refunded deterministically?
- Is there an immutable receipt chain for disputes/compliance?

Without this layer, “agentic commerce” is fragile automation with weak accountability.

## Product

Nooterra provides a host-agnostic control plane with:

- Identity and passport rails (`AgentIdentity.v1`, `AgentPassport.v1`)
- Delegated authority (`DelegationGrant.v1`) with runtime spend/scope enforcement
- Collaboration contracts (`SubAgentWorkOrder.v1`, `SubAgentCompletionReceipt.v1`)
- Discovery (`AgentCard.v1`) + capability trust (`CapabilityAttestation.v1`)
- x402 lifecycle controls (hold -> verify -> release/refund)
- Deterministic evidence, receipts, and dispute/reversal hooks
- Prompt-contagion and bad-actor guardrails with forced challenge/escalate modes

## Why now

x402 is becoming standard payment plumbing, and agent frameworks are multiplying.

The bottleneck has moved to trust orchestration between agents and hosts.

Nooterra is positioned at that bottleneck.

## ICP

1. Agent runtime operators that need safe delegated spend and receipts.
2. Agent marketplaces that need verifiable completion and dispute-grade artifacts.
3. Enterprise teams deploying internal agent swarms with governance constraints.

## Differentiation

1. Runtime enforcement, not just schemas.
2. Settlement bound directly to work-order evidence.
3. Host neutrality: OpenClaw, Nooterra, Claude Desktop, Cursor, custom runtimes.
4. Fail-closed defaults on high-risk paths.

## Integration strategy

Primary distribution:

- MCP tool surface (`nooterra.*`)
- OpenClaw plugin/skill onboarding
- Terminal-first onboarding (`nooterra setup/login/doctor`)

Secondary distribution:

- Public protocol specs for ecosystem adoption
- “Nooterra Verified” conformance badge for providers/runtimes

## 30-day goals

1. Publish public collaboration specs.
2. Launch Nooterra Verified criteria and badge checks.
3. Ship and record one end-to-end collaboration demo (work order + settlement + receipt).
4. Close first production design partners on runtime trust controls.
