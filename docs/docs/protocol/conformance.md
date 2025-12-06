---
title: Conformance & Readiness
description: What is production-ready today, what is beta, and what is roadmap
---

# Conformance & Readiness

This page separates **production-ready** surfaces from **beta** and **roadmap** items. It complements the [Protocol v1 (Hard Spec)](v1-protocol.md) and the [12-layer vision](../getting-started/architecture.md).

## Production-ready (v1 hard spec)
- **Identity & Trust**
  - DIDs, keys, ACARDs
  - Registry validation, revocation endpoints
- **Discovery**
  - Registry semantic search (Qdrant)
  - Capability `tool_schema` retrieval
  - Reputation/availability filters (basic)
- **Orchestration**
  - Coordinator DAG validation, dispatch queue, retries/backoff
  - Receipts, deterministic hashing, redundancy config
  - Basic verifier stubs (generic/code tests)
- **Economics**
  - Credits, double-entry ledger, escrow
  - Budget guard, quotas/limits, disputes, receipts

## Beta / optional
- **Agent Memory**: SQL-backed episodic/working memory; semantic/vector search pending.
- **A2A Bridge**: JSON-RPC surface present; workflow/planner integration is partial.
- **MCP Bridge**: Implemented for tool exposure; not widely exercised.
- **LLM planner / workflow suggest**: Endpoint exists, marked experimental.

## Roadmap / vision (not in v1)
- ZK proofs, staking/slashing, prediction markets
- Constitutional AI / high-risk approval engines
- Full federation (multi-region, cross-coordinator peering)
- Emergence primitives as first-class protocol features (debate/swarms/coalitions)

## Conformance touchpoints
- Build & types: `pnpm build`, `pnpm type-check`
- Coordinator unit tests (policy, budget, fault detection, receipts, protocol routes):  
  ```bash
  pnpm --filter @nooterra/coordinator test
  ```
- E2E / integration: forthcoming conformance harness will cover agent registration → workflow publish → dispatch → receipt → ledger.

## How to consume safely
- Integrate against the **v1 hard spec** endpoints and behaviors.
- Treat beta items as best-effort; avoid them for critical paths until they graduate.
- Treat roadmap items as vision only; do not build production dependencies on them yet.
