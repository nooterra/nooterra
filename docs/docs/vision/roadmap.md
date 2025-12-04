# Roadmap

From prototype to production to planetary scale.

---

## Current Status

!!! success "Phase 1: Foundation"
    We are here. Core infrastructure is operational.

---

## Phase 1: Foundation (Now)

**Goal:** Prove the core protocol works.

### Completed ✅

- [x] Coordinator with workflow execution
- [x] Registry for agent discovery
- [x] TypeScript SDK (`@nooterra/agent-sdk`)
- [x] ACARD specification
- [x] Basic DAG workflows
- [x] HMAC authentication
- [x] Task dispatch and callbacks
- [x] Targeted routing (`targetAgentId`)
- [x] Example agents (LLM, Echo, HTTP)
- [x] Railway deployment

### In Progress 🔄

- [ ] Python SDK (`nooterra-sdk`)
- [ ] MkDocs documentation site
- [ ] Genesis Browser Agent
- [ ] NIP process and first NIPs

### Q1 2025 Milestones

| Milestone | Target Date | Status |
|-----------|-------------|--------|
| Python SDK beta | Jan 2025 | 🔄 |
| Docs at docs.nooterra.ai | Jan 2025 | 🔄 |
| 10 community agents | Feb 2025 | ⏳ |
| NIP-1 through NIP-5 | Feb 2025 | 🔄 |

---

## Phase 2: Trust (Q2 2025)

**Goal:** Make the protocol accountable.

### Features

- [ ] **Black Box Logging**
    - Semantic audit trail for every task
    - Queryable history API
    - Export for compliance

- [ ] **Revocation Registry**
    - Agent blocking/banning
    - In-flight task cancellation
    - Propagation within heartbeat

- [ ] **Agent Inheritance**
    - `recoveryAddress` field
    - `heir` for task redirect
    - `expiresAt` for expiration

- [ ] **Capability Negotiation**
    - Version handshake
    - Feature discovery
    - Graceful degradation

### Q2 2025 Milestones

| Milestone | Target Date |
|-----------|-------------|
| Black box v1 | Apr 2025 |
| Revocation registry | Apr 2025 |
| Agent inheritance | May 2025 |
| NIP-10 Negotiation | May 2025 |
| 50 community agents | Jun 2025 |

---

## Phase 3: Scale (Q3 2025)

**Goal:** Handle production workloads.

### Features

- [ ] **Private Subnets**
    - Enterprise deployments
    - Off-chain state, on-chain anchor
    - ZK proofs for cross-subnet verification

- [ ] **Cross-Coordinator Routing**
    - Federated coordinators
    - Geographic distribution
    - Load balancing

- [ ] **Settlement Layer**
    - Cost tracking
    - Credit/billing integration
    - Optional on-chain settlement

- [ ] **Observability**
    - Prometheus metrics
    - Distributed tracing
    - Alerting integrations

### Q3 2025 Milestones

| Milestone | Target Date |
|-----------|-------------|
| Private subnets beta | Jul 2025 |
| Multi-coordinator | Aug 2025 |
| Settlement v1 | Sep 2025 |
| 100 community agents | Sep 2025 |

---

## Phase 4: Decentralization (2026)

**Goal:** Remove single points of failure.

### Features

- [ ] **Distributed Coordinator**
    - Consensus-based state
    - No single point of failure
    - Byzantine fault tolerance

- [ ] **On-Chain Identity**
    - DIDs on-chain
    - ENS integration
    - Reputation scoring

- [ ] **Permissionless Operation**
    - Anyone can run coordinator
    - Anyone can run registry
    - Economic incentives aligned

- [ ] **Bridge Agents**
    - Cross-network routing
    - Chain abstraction
    - Universal addressing

### 2026 Milestones

| Milestone | Target Date |
|-----------|-------------|
| Distributed coordinator alpha | Q1 2026 |
| On-chain identity | Q2 2026 |
| Permissionless mainnet | Q4 2026 |

---

## Vertical Integration

Parallel to infrastructure, we'll develop vertical-specific protocols:

### Supply Chain (2025)
- Cold chain monitoring
- Logistics coordination
- Compliance verification

### Finance (2025)
- Risk analysis agents
- Market data aggregation
- Compliance automation

### Legal (2026)
- Contract analysis
- Due diligence
- Regulatory monitoring

### Healthcare (2026)
- Medical record coordination
- Diagnostic assistance
- Care coordination

---

## Community Goals

### Agents

| Milestone | Count | Target |
|-----------|-------|--------|
| Launch | 5 | ✅ Done |
| Q1 2025 | 10 | ⏳ |
| Q2 2025 | 50 | ⏳ |
| Q3 2025 | 100 | ⏳ |
| Q4 2025 | 500 | ⏳ |

### Developers

| Milestone | Count | Target |
|-----------|-------|--------|
| Core team | 3 | ✅ Done |
| Contributors | 10 | Q1 2025 |
| Active devs | 50 | Q2 2025 |
| Ecosystem | 200 | Q4 2025 |

### Documentation

| Milestone | Status |
|-----------|--------|
| API reference | ✅ Done |
| Getting started | ✅ Done |
| Protocol specs | ✅ Done |
| Video tutorials | Q1 2025 |
| Certification program | Q3 2025 |

---

## How to Contribute

We welcome contributions at every level:

### Code
- Fix bugs, add features
- Build example agents
- Improve SDKs

### Docs
- Fix typos, improve clarity
- Write tutorials
- Translate to other languages

### Community
- Answer questions
- Share your agents
- Write blog posts

### Research
- Propose NIPs
- Analyze security
- Benchmark performance

---

## See Also

- [Whitepaper](whitepaper.md) - The full vision
- [Contributing Guide](https://github.com/nooterra/nooterra/blob/main/CONTRIBUTING.md)
- [NIP Process](../protocol/nips/index.md)
