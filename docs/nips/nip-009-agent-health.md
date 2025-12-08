# NIP-009: Agent Health Metrics Standard

| Field | Value |
|-------|-------|
| NIP | 009 |
| Title | Agent Health Metrics |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Define a standard health endpoint that all agents must expose for monitoring and routing decisions.

## Specification

### Required Endpoint

All agents MUST expose:

```
GET /nooterra/health
```

### Response Schema

```json
{
  "status": "healthy",
  "version": "1.2.3",
  "agentDid": "did:noot:agent:summarizer",
  "uptime": {
    "seconds": 86400,
    "startedAt": "2024-12-06T00:00:00Z"
  },
  "capabilities": [
    {
      "name": "cap.summarize.v1",
      "status": "active",
      "avgLatencyMs": 150
    }
  ],
  "queue": {
    "pending": 5,
    "processing": 2,
    "maxConcurrent": 10
  },
  "performance": {
    "requestsTotal": 15000,
    "requestsSucceeded": 14988,
    "requestsFailed": 12,
    "successRate": 0.9992,
    "avgLatencyMs": 150,
    "p95LatencyMs": 350,
    "p99LatencyMs": 800
  },
  "resources": {
    "memoryUsedMb": 256,
    "memoryLimitMb": 512,
    "cpuUsagePercent": 35
  },
  "dependencies": [
    {
      "name": "openai",
      "status": "healthy",
      "latencyMs": 200
    }
  ],
  "metadata": {
    "region": "us-west-1",
    "instanceId": "agent-001"
  }
}
```

### Status Values

| Status | Description | Routing Impact |
|--------|-------------|----------------|
| `healthy` | Normal operation | Route normally |
| `degraded` | Reduced capacity | Reduce traffic |
| `unhealthy` | Not accepting new tasks | Don't route |
| `draining` | Finishing current, no new | Graceful shutdown |

### Coordinator Usage

The coordinator uses health metrics for:

1. **Routing decisions**: Prefer agents with lower queue depth
2. **Load balancing**: Distribute based on capacity
3. **Alerting**: Flag agents with high failure rates
4. **Eviction**: Remove unresponsive agents

```typescript
function selectAgent(candidates: Agent[], capability: string): Agent {
  // Filter unhealthy
  const healthy = candidates.filter(a => 
    a.health.status === 'healthy' || a.health.status === 'degraded'
  );
  
  // Score by: success rate * (1 / latency) * (1 / queue depth)
  const scored = healthy.map(a => ({
    agent: a,
    score: a.health.performance.successRate 
           * (1000 / a.health.performance.avgLatencyMs)
           * (1 / (a.health.queue.pending + 1))
  }));
  
  // Weighted random selection (higher score = more likely)
  return weightedRandom(scored);
}
```

### Health Check Frequency

- Coordinator polls agents every **30 seconds**
- Agents can push updates via heartbeat
- 3 consecutive failures = mark offline

### SDK Implementation

```typescript
// @nooterra/agent-sdk
import { healthMiddleware } from '@nooterra/agent-sdk';

const agent = createAgent({
  capabilities: ['cap.summarize.v1'],
});

// Automatically tracks metrics and exposes /nooterra/health
agent.use(healthMiddleware());

agent.start();
```

## Copyright

Public domain.
