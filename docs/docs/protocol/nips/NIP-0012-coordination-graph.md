# NIP-0012: Coordination Graph & Stigmergic Routing

**Status:** Draft  
**Created:** 2025-12-06  
**Authors:** Nooterra Core Team

---

## Abstract

This NIP defines the **Coordination Graph** — a dynamic, weighted graph structure that governs how agents discover, route to, and learn from each other. It introduces six canonical **Message Types**, a **Stigmergic Blackboard** system for indirect coordination, and a **Router** interface that allows v1 deterministic routing to evolve into learned routing without protocol changes.

The Coordination Graph transforms Nooterra from a task dispatcher into an **Economic Nervous System**: agents as neurons, messages as synapses, blackboards as neuromodulators, and collective intelligence as emergent behavior.

---

## Motivation

### The Problem with Static Routing

Current agent coordination systems use static rules:
- Capability match → pick cheapest/fastest agent
- Round-robin or random selection
- Manual affinity rules

This ignores:
- **Temporal dynamics**: Which agents are currently congested?
- **Historical performance**: Which capability→capability paths succeed?
- **Emergent patterns**: Which agent combinations work well together?
- **Collective learning**: How do individual successes improve system-wide routing?

### Prior Art: MARL & Stigmergy

Multi-Agent Reinforcement Learning (MARL) research has converged on key insights:

1. **Coordination Graphs** (DICG, MAGIC, GNN-based MARL): Model agents as nodes, coordination relationships as edges, and use attention/GNNs to learn dynamic edge weights.

2. **Stigmergic Coordination**: Agents communicate indirectly by leaving traces in a shared environment (like ant pheromones). This scales to millions of agents without central bottlenecks.

3. **Machine Economies**: Protocols like Google's A2A, Stripe's ACP, and Coinbase's x402 treat agents as economic actors. Coordination and payment are inseparable.

Nooterra synthesizes these into a protocol primitive, not a library.

---

## Specification

### 1. Coordination Graph Semantics

#### 1.1 Nodes

Every **Agent** is a node in the Coordination Graph.

```typescript
interface GraphNode {
  agentId: string;              // DID
  capabilities: string[];       // Capability IDs
  profileLevel: number;         // 0-6 (NIP-0001)
  region?: string;              // Geographic/logical region
  tenantId?: string;            // Multi-tenancy isolation
}
```

#### 1.2 Edges

An **Edge** connects two capabilities (not agents directly), representing "calls from capability A tend to route to capability B."

```typescript
interface CoordinationEdge {
  id: string;
  fromCapability: string;       // e.g., "ml.text.generate"
  toCapability: string;         // e.g., "db.sql.query"
  profileLevel: number;
  region?: string;
  tenantId?: string;
  
  // Aggregated statistics
  callCount: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgPriceNcr: number;
  
  // Derived scores
  reputationScore: number;      // 0.0 - 1.0
  congestionScore: number;      // 0.0 - 1.0
  
  // Manual overrides
  weightOverride?: number;
  
  lastUsedAt: Date;
  metadata: Record<string, unknown>;
}
```

#### 1.3 Weight Calculation (v1 Formula)

Edge weight for routing decisions:

```
W = reputation × (1 / log(10 + latency_ms)) × (1 / log(10 + price_ncr)) × profile_penalty × blackboard_boost
```

Where:
- `reputation` = `successCount / (successCount + failureCount)` or 0.5 if no history
- `profile_penalty` = 0.1 if agent profile < required, else 1.0
- `blackboard_boost` = 1.0 + hints from stigmergic memory (see §3)

v2+ MAY replace this with a learned model (GNN, attention) that respects the same interface.

---

### 2. Message Types

All agent communication uses one of six canonical message types.

```typescript
enum MessageType {
  TASK = "TASK",               // Do work with commitment
  QUERY = "QUERY",             // Request information, no commitment
  PROPOSAL = "PROPOSAL",       // Suggest a plan/contract
  ATTESTATION = "ATTESTATION", // Verifiable claim
  GRADIENT = "GRADIENT",       // Feedback signal
  STATE = "STATE",             // Blackboard update
}
```

#### 2.1 Message Envelope

Every message carries standard metadata:

```typescript
interface NootMessage {
  id: string;                   // UUID
  type: MessageType;
  timestamp: string;            // ISO8601
  sender: string;               // Agent DID
  receiver?: string;            // Agent DID or broadcast
  correlationId?: string;       // Workflow/trace ID
  profileLevel: number;         // 0-6
  constitutionId?: string;      // Which constitution applies
  
  economic: EconomicEnvelope;
  crypto: CryptoEnvelope;
  payload: MessagePayload;
}

interface EconomicEnvelope {
  currency: "NCR" | "EXTERNAL";
  budgetNcr?: number;
  pricePerUnitNcr?: number;
  externalPaymentRef?: string;  // ACP/AP2/x402 session
  escrowId?: string;
}

interface CryptoEnvelope {
  signatureType: "ed25519" | "hmac-sha256" | "none";
  signer: string;               // Public key or DID
  signature: string;            // Base64
  receiptRef?: string;          // Link to stored receipt
}
```

#### 2.2 Payload Types

```typescript
interface TaskPayload {
  capability: string;
  input: unknown;
  constraints?: {
    timeoutMs?: number;
    maxPriceNcr?: number;
    region?: string;
    requiredProfiles?: number[];
  };
}

interface QueryPayload {
  capability: string;
  query: unknown;
}

interface ProposalPayload {
  proposedWorkflowId?: string;
  tasks?: TaskPayload[];
  terms?: unknown;
}

interface AttestationPayload {
  subject: string;              // What is being attested
  claims: Record<string, unknown>;
  proofRef?: string;
}

interface GradientPayload {
  targetMessageId: string;      // Which message this feedback is for
  reward: number;               // Scalar score
  details?: unknown;
}

interface StatePayload {
  namespace: string;
  capability: string;
  contextHash: string;
  delta: {
    successWeight?: number;
    failureWeight?: number;
    congestionScore?: number;
  };
}
```

---

### 3. Stigmergic Blackboards

Blackboards provide indirect coordination through shared state that decays over time.

#### 3.1 Schema

```typescript
interface Blackboard {
  id: string;
  namespace: string;            // "routing", "scheduling", etc.
  capability: string;
  contextHash: string;          // Hash of problem context
  
  successWeight: number;        // Accumulated success signals
  failureWeight: number;        // Accumulated failure signals
  congestionScore: number;      // Current load indicator
  
  preferredAgents: string[];    // Agent DIDs with bonus
  tags: string[];
  metadata: Record<string, unknown>;
  
  updatedAt: Date;
}
```

#### 3.2 Decay Function

Pheromone values decay exponentially:

```
V(t) = V₀ × 0.5^(Δt / T½)
```

Where:
- `V₀` = value at last update
- `Δt` = seconds since last update
- `T½` = half-life (default: 3600 seconds = 1 hour)

Implementation:

```typescript
const HALF_LIFE_SECONDS = 3600;

function applyDecay(value: number, lastUpdated: Date, now: Date): number {
  if (value === 0) return 0;
  const dtSec = (now.getTime() - lastUpdated.getTime()) / 1000;
  const decayFactor = Math.pow(0.5, dtSec / HALF_LIFE_SECONDS);
  return value * decayFactor;
}
```

#### 3.3 Update Protocol

After each workflow node execution:

1. **On Success**: Emit `STATE` message with `delta.successWeight += 1.0`
2. **On Failure**: Emit `STATE` message with `delta.failureWeight += 1.0`
3. **On High Latency**: Emit `STATE` message with `delta.congestionScore += 0.5`

Coordinators aggregate these into blackboard state.

#### 3.4 Blackboard Boost Calculation

When routing, boost = f(blackboard hints):

```typescript
function getBlackboardBoost(hints: Blackboard[], candidate: Agent): number {
  const hint = hints.find(h => h.capability === candidate.capability);
  if (!hint) return 1.0;
  
  let boost = 1.0;
  
  // Preferred agent bonus
  if (hint.preferredAgents.includes(candidate.agentId)) {
    boost *= 1.2;
  }
  
  // Success/failure ratio
  const total = hint.successWeight + hint.failureWeight;
  if (total > 0) {
    const successRatio = hint.successWeight / total;
    boost *= (0.5 + successRatio); // Range: 0.5 - 1.5
  }
  
  // Congestion penalty
  if (hint.congestionScore > 0.5) {
    boost *= (1.0 - hint.congestionScore * 0.4); // Max 40% penalty
  }
  
  return boost;
}
```

---

### 4. Router Interface

All routing goes through a pluggable `Router` interface.

```typescript
interface RouterContext {
  profileLevel: number;
  region?: string;
  tenantId?: string;
  blackboardHints: Blackboard[];
  workflowId?: string;
}

interface CandidateTarget {
  agentId: string;
  capability: string;
  endpoint: string;
  profileLevel: number;
  region?: string;
  basePriceNcr?: number;
  historicalStats?: {
    reputationScore: number;
    avgLatencyMs?: number;
    p95LatencyMs?: number;
  };
}

interface RoutedTarget {
  agentId: string;
  capability: string;
  endpoint: string;
  weight: number;             // Normalized 0-1
}

interface Router {
  selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]>;
}
```

#### 4.1 v1 Default Router

Deterministic scoring:

```typescript
class DefaultRouter implements Router {
  async selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    ctx: RouterContext
  ): Promise<RoutedTarget[]> {
    const scored = candidates.map(c => {
      const rep = c.historicalStats?.reputationScore ?? 0.5;
      const latency = c.historicalStats?.avgLatencyMs ?? 1000;
      const price = c.basePriceNcr ?? 1;
      
      const latencyScore = 1 / Math.log(10 + latency);
      const priceScore = 1 / Math.log(10 + price);
      const profilePenalty = c.profileLevel < ctx.profileLevel ? 0.1 : 1.0;
      const bbBoost = this.getBlackboardBoost(ctx.blackboardHints, c);
      
      const score = rep * latencyScore * priceScore * profilePenalty * bbBoost;
      
      return { ...c, score };
    });
    
    const maxScore = Math.max(...scored.map(s => s.score), 0.000001);
    
    return scored
      .map(s => ({
        agentId: s.agentId,
        capability: s.capability,
        endpoint: s.endpoint,
        weight: s.score / maxScore,
      }))
      .sort((a, b) => b.weight - a.weight)
      .filter(t => t.weight > 0.2)
      .slice(0, 3);
  }
}
```

#### 4.2 Feature Flag Rollout

```typescript
// Environment variables
USE_COORDINATION_GRAPH=false    // Use new router
SHADOW_COORDINATION_GRAPH=true  // Run both, compare

// Router factory
function createRouter(): Router {
  if (config.useCoordinationGraph) {
    return new CoordinationGraphRouter();
  }
  return new LegacyRouter();
}
```

Shadow mode runs both routers in parallel, logs divergence for analysis.

---

### 5. Collective Objectives

The Coordination Graph enables optimization beyond individual agent utility.

#### 5.1 Local vs Global

| Level | Objective | Optimized By |
|-------|-----------|--------------|
| Agent | Maximize NCR income, reputation | Individual bidding/execution |
| Coordinator | Minimize workflow latency, cost | Router selection |
| Protocol | Maximize throughput, fault tolerance, diversity | Edge aggregation, bounties |

#### 5.2 Capability Pressure

The protocol tracks demand vs supply per capability:

```typescript
interface CapabilityPressure {
  capability: string;
  demandCount: number;          // Requests in last hour
  supplyCount: number;          // Available agents
  fillRate: number;             // Successful fills / requests
  avgWaitMs: number;            // Time to find agent
}
```

When `fillRate < 0.8` or `avgWaitMs > 5000`, emit a **Bounty** (via existing bounty system) to attract new agents for that capability.

This is evolution at the population level: successful agents thrive, gaps attract new entrants.

---

### 6. Federated Coordination

For multi-coordinator deployments (Layer 9), the Coordination Graph extends to inter-coordinator routing.

#### 6.1 Coordinator as Agent

Each Coordinator registers as an agent with capability `meta.coordinator.route`:

```yaml
id: coordinator-us-west
capabilities:
  - id: meta.coordinator.route
    description: Route to agents in US-West region
    regions: [us-west-1, us-west-2]
```

#### 6.2 Federated Attention

Inter-coordinator routing uses the same edge structure:

```
from: coordinator-us-east
to: coordinator-us-west
weight: f(capability overlap, historical success, latency)
```

Coordinators "attend" to each other based on capability relevance, forming a dynamic federation without hard-coded topology.

---

## Backwards Compatibility

- **v1 Coordinators**: Continue using existing routing; new tables are additive.
- **v1 Agents**: No changes required; message types are envelope metadata.
- **Upgrade Path**: Enable `USE_COORDINATION_GRAPH=true` after edge aggregation populates.

---

## Security Considerations

1. **Blackboard Poisoning**: Malicious agents could spam `STATE` messages to bias routing. Mitigate with rate limits, reputation-weighted updates, and anomaly detection.

2. **Edge Manipulation**: Fake success/failure signals could skew edge weights. Mitigate by requiring signed receipts for updates.

3. **Privacy**: Edge data reveals coordination patterns. For private subnets, edge aggregation stays local; only capability-level (not agent-level) stats are shared.

---

## Implementation Notes

### Database Schema (Postgres/Drizzle)

```sql
-- Coordination Edges
CREATE TABLE coordination_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_capability TEXT NOT NULL,
  to_capability TEXT NOT NULL,
  profile_level SMALLINT NOT NULL DEFAULT 0,
  region TEXT,
  tenant_id UUID,
  
  call_count BIGINT NOT NULL DEFAULT 0,
  success_count BIGINT NOT NULL DEFAULT 0,
  failure_count BIGINT NOT NULL DEFAULT 0,
  avg_latency_ms DOUBLE PRECISION,
  p95_latency_ms DOUBLE PRECISION,
  avg_price_ncr DOUBLE PRECISION,
  reputation_score DOUBLE PRECISION DEFAULT 0.0,
  congestion_score DOUBLE PRECISION DEFAULT 0.0,
  weight_override DOUBLE PRECISION,
  
  last_used_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  UNIQUE (from_capability, to_capability, profile_level, region, tenant_id)
);

-- Stigmergic Blackboards
CREATE TABLE blackboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL,
  capability TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  
  success_weight DOUBLE PRECISION DEFAULT 0.0,
  failure_weight DOUBLE PRECISION DEFAULT 0.0,
  congestion_score DOUBLE PRECISION DEFAULT 0.0,
  
  preferred_agents UUID[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (namespace, capability, context_hash)
);

-- Blackboard Events (audit trail)
CREATE TABLE blackboard_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blackboard_id UUID NOT NULL REFERENCES blackboards(id),
  event_type TEXT NOT NULL,
  delta_success DOUBLE PRECISION,
  delta_failure DOUBLE PRECISION,
  delta_congestion DOUBLE PRECISION,
  source_workflow_id UUID,
  source_agent_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Aggregation Job

Run every 5 minutes:

```typescript
async function aggregateEdges(since: Date) {
  const stats = await db.query(`
    SELECT 
      tn.capability_id as from_cap,
      tn2.capability_id as to_cap,
      COUNT(*) as calls,
      SUM(CASE WHEN tn2.status = 'success' THEN 1 ELSE 0 END) as successes,
      AVG(EXTRACT(EPOCH FROM (tn2.completed_at - tn2.started_at)) * 1000) as avg_latency
    FROM task_nodes tn
    JOIN task_nodes tn2 ON tn2.workflow_id = tn.workflow_id 
      AND tn.name = ANY(tn2.depends_on)
    WHERE tn.completed_at >= $1
    GROUP BY 1, 2
  `, [since]);
  
  for (const row of stats) {
    await upsertCoordinationEdge(row);
  }
}
```

---

## References

1. **DICG**: Deep Implicit Coordination Graphs for Multi-Agent Reinforcement Learning
2. **MAGIC**: Multi-Agent Graph Attention Communication
3. **Stigmergic MARL**: Indirect Coordination in Multi-Agent Systems
4. **A2A Protocol**: Google Agent-to-Agent Protocol
5. **AP2**: Agent Payments Protocol (Google)
6. **x402**: Coinbase Agent Payment Protocol

---

## Changelog

- **v0.1** (2025-12-06): Initial draft

---

*This NIP is part of the Nooterra Protocol Specification.*
