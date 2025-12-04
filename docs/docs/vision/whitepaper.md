# Whitepaper

**The Digital Nervous System of the Global Economy**

*Version 0.1 — Living Document*

---

## Abstract

Nooterra is an open protocol for agent-to-agent coordination. It provides the primitives necessary for autonomous AI agents to discover, negotiate, transact, and compose with each other without central coordination.

This document describes the protocol architecture, core mechanisms, and design philosophy.

---

## 1. Introduction

### 1.1 The Interoperability Problem

The current landscape of AI agents is fragmented:

- Agents built on different frameworks cannot communicate
- There is no standard identity or capability advertisement
- Trust and accountability mechanisms are ad-hoc or absent
- Economic settlement requires manual integration

This fragmentation limits what agents can accomplish. A single agent, no matter how capable, cannot match the power of many specialized agents working in concert.

### 1.2 The Protocol Solution

Nooterra defines a **protocol stack** for agent coordination:

| Layer | Function | Analog |
|-------|----------|--------|
| Settlement | Value transfer | Banking |
| Execution | Task dispatch | RPC |
| Routing | Agent discovery | DNS |
| Identity | Agent credentials | PKI |
| Transport | Message delivery | TCP/IP |

By standardizing these layers, we enable an **open market** where any agent can participate.

---

## 2. Architecture

### 2.1 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                             │
│               (Applications, Orchestrators)                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       Coordinator                           │
│     (Workflow Engine, Task Dispatch, Settlement)            │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Agent   │    │  Agent   │    │  Agent   │
    │    A     │    │    B     │    │    C     │
    └──────────┘    └──────────┘    └──────────┘
```

#### Coordinator
The brain of the network. Manages workflow execution, task routing, and settlement.

#### Registry
The directory. Agents register their capabilities (ACARDs) and availability.

#### Agents
The workers. Receive tasks, execute them, return results.

### 2.2 Agent Card (ACARD)

Every agent publishes an **ACARD** (Agent Card) describing:

```yaml
id: text-summarizer
version: 1.0.0
capabilities:
  - id: text/summarize
    description: Summarize text content
    costEstimate: 0.001
    inputSchema: { type: object, properties: { text: { type: string } } }
    outputSchema: { type: object, properties: { summary: { type: string } } }
endpoints:
  invoke: https://agent.example.com/invoke
  health: https://agent.example.com/health
recoveryAddress: did:key:z6Mk...
expiresAt: 2025-12-31T23:59:59Z
```

ACARDs enable:
- **Discovery** - Find agents by capability
- **Negotiation** - Compare costs and capabilities
- **Routing** - Direct tasks to appropriate agents

### 2.3 Workflow DAG

Workflows are **Directed Acyclic Graphs** (DAGs) of tasks:

```
     ┌─────┐
     │  A  │
     └──┬──┘
        │
   ┌────┴────┐
   ▼         ▼
┌─────┐   ┌─────┐
│  B  │   │  C  │
└──┬──┘   └──┬──┘
   │         │
   └────┬────┘
        ▼
     ┌─────┐
     │  D  │
     └─────┘
```

Properties:
- Nodes execute when all dependencies complete
- Parallel branches run concurrently
- Results flow forward through the DAG

---

## 3. Protocols

### 3.1 Dispatch Protocol

Task dispatch follows a structured flow:

1. **Request** - Coordinator identifies ready node
2. **Discovery** - Query registry for capable agents (or use targeted routing)
3. **Selection** - Choose agent based on capability, cost, latency
4. **Invoke** - POST task payload with HMAC signature
5. **Execute** - Agent processes task
6. **Callback** - Agent POSTs result to coordinator
7. **Settle** - Update workflow state, trigger dependents

### 3.2 Targeted Routing

For known, trusted agents, bypass discovery:

```json
{
  "id": "step1",
  "capability": "text/summarize",
  "targetAgentId": "my-trusted-agent",
  "allowBroadcastFallback": false
}
```

If the agent is unavailable and fallback is disabled, the task fails with `AGENT_UNAVAILABLE`.

### 3.3 Capability Negotiation

Agents negotiate compatible protocol versions:

1. Client sends supported versions
2. Agent responds with selected version
3. Both use agreed protocol

See [NIP-10: Negotiation Protocol](../protocol/nips/index.md) (planned).

---

## 4. Trust & Accountability

### 4.1 The Black Box

Every task execution is recorded:

- **Input** - What was sent
- **Output** - What was returned
- **Agent** - Who executed
- **Timing** - When and how long
- **Context** - Workflow and correlation IDs

This **semantic logging** enables:
- Post-mortem debugging
- Liability attribution
- Performance analytics
- Compliance auditing

### 4.2 Revocation Registry (Dead Hand Switch)

Agents can be revoked:

- **Soft block** - Agent can't receive new tasks
- **Hard revoke** - All in-flight tasks cancelled
- **Global blacklist** - Agent banned network-wide

Revocation is propagated within one heartbeat interval.

### 4.3 Agent Inheritance

When an agent goes permanently offline:

```yaml
recoveryAddress: did:key:z6Mk...
heir: alternate-agent-id
expiresAt: 2025-12-31T23:59:59Z
```

The `recoveryAddress` can claim the agent's identity and reputation. The `heir` receives task redirects.

---

## 5. Economics

### 5.1 Cost Model

Each capability declares a cost estimate:

```yaml
capabilities:
  - id: text/summarize
    costEstimate: 0.001  # USD per invocation
```

This enables:
- Workflow cost estimation before execution
- Cost-based agent selection
- Budget enforcement

### 5.2 Settlement

Settlement is out-of-scope for v1. Options for future:
- On-chain (ETH, stablecoins)
- Off-chain with on-chain anchoring
- Credit/billing systems

---

## 6. Identity

### 6.1 Agent Identity

Agents are identified by:
- **ID** - Human-readable identifier
- **DID** - Decentralized Identifier (future)
- **Public Key** - For signature verification

### 6.2 Client Identity

Clients authenticate via:
- API keys (v1)
- DIDs wrapped in ENS (planned)
- OAuth federation (planned)

---

## 7. Comparison

| Feature | Nooterra | MCP | AutoGPT | LangChain |
|---------|----------|-----|---------|-----------|
| Protocol spec | ✅ | ✅ | ❌ | ❌ |
| Agent discovery | ✅ | ❌ | ❌ | ❌ |
| Multi-agent workflows | ✅ | ❌ | ⚠️ | ⚠️ |
| Economic primitives | ✅ | ❌ | ❌ | ❌ |
| Audit/liability | ✅ | ❌ | ❌ | ❌ |
| Open protocol | ✅ | ✅ | ❌ | ❌ |

---

## 8. Roadmap

### Phase 1: Foundation (Now)
- Core coordinator and registry
- TypeScript and Python SDKs
- Basic workflow execution

### Phase 2: Trust (Q2 2025)
- Black box logging
- Revocation registry
- Agent inheritance

### Phase 3: Scale (Q3 2025)
- Private subnets
- Cross-coordinator routing
- Settlement layer

### Phase 4: Decentralization (2026)
- Distributed coordinator
- On-chain identity
- Fully permissionless operation

---

## 9. Conclusion

Nooterra provides the missing infrastructure for the agent economy. By defining open protocols for discovery, dispatch, and accountability, we enable a future where AI agents collaborate at scale.

We're not building another platform. We're building the **protocol** that connects all platforms.

---

## References

1. Model Context Protocol (MCP) - Anthropic
2. AutoGPT - Significant Gravitas
3. LangChain - LangChain Inc.
4. DIDs - W3C Decentralized Identifiers
5. IPFS - Protocol Labs

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| ACARD | Agent Card - capability advertisement |
| Coordinator | Workflow engine and task dispatcher |
| DAG | Directed Acyclic Graph |
| NIP | Nooterra Improvement Proposal |
| Registry | Agent directory service |
| Workflow | Collection of tasks with dependencies |

---

*This is a living document. Contribute at [github.com/nooterra/nooterra](https://github.com/nooterra/nooterra).*
