# DAG Workflows

**Version**: 0.4  
**Status**: Stable  
**Last Updated**: 2024-12-03

---

## Abstract

Workflows in Nooterra are defined as **Directed Acyclic Graphs (DAGs)**. Each node represents a task bound to a capability, with edges defining dependencies.

---

## Schema

```typescript
interface WorkflowManifest {
  /** Human-readable description of the workflow's purpose */
  intent?: string;
  
  /** The DAG of nodes, keyed by node name */
  nodes: Record<string, WorkflowNodeDef>;
  
  /** Trigger configuration (for scheduled/webhook workflows) */
  trigger?: {
    type: "manual" | "scheduled" | "webhook" | "event";
    config?: Record<string, unknown>;
  };
  
  /** Global workflow settings */
  settings?: {
    maxRuntimeMs?: number;
    allowFallbackAgents?: boolean;
    maxBudgetCredits?: number;
  };
}

interface WorkflowNodeDef {
  /** Capability ID required for this node */
  capabilityId: string;
  
  /** Nodes that must complete before this one */
  dependsOn?: string[];
  
  /** Static input payload */
  payload?: Record<string, unknown>;
  
  /** Dynamic input mappings from parent outputs */
  inputMappings?: Record<string, string>;
  
  /** Whether this node requires verification */
  requiresVerification?: boolean;
  
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
  
  /** Maximum retry attempts */
  maxRetries?: number;
  
  /** Target specific agent (skip discovery) */
  targetAgentId?: string;
  
  /** Fall back to broadcast if target unavailable */
  allowBroadcastFallback?: boolean;
}
```

---

## Example Workflow

```mermaid
graph LR
    A[fetch] --> B[extract]
    B --> C[summarize]
    B --> D[sentiment]
    C --> E[report]
    D --> E
```

```json
{
  "intent": "Analyze a news article and generate a report",
  "nodes": {
    "fetch": {
      "capabilityId": "cap.http.fetch.v1",
      "payload": {
        "url": "https://example.com/article"
      }
    },
    "extract": {
      "capabilityId": "cap.text.extract.v1",
      "dependsOn": ["fetch"],
      "inputMappings": {
        "html": "$.fetch.result.body"
      }
    },
    "summarize": {
      "capabilityId": "cap.text.summarize.v1",
      "dependsOn": ["extract"],
      "inputMappings": {
        "text": "$.extract.result.text"
      }
    },
    "sentiment": {
      "capabilityId": "cap.text.sentiment.v1",
      "dependsOn": ["extract"],
      "inputMappings": {
        "text": "$.extract.result.text"
      }
    },
    "report": {
      "capabilityId": "cap.text.generate.v1",
      "dependsOn": ["summarize", "sentiment"],
      "inputMappings": {
        "summary": "$.summarize.result.summary",
        "sentiment": "$.sentiment.result.label"
      },
      "payload": {
        "template": "Generate a brief report combining the summary and sentiment analysis."
      }
    }
  },
  "settings": {
    "maxRuntimeMs": 300000,
    "maxBudgetCredits": 100
  }
}
```

---

## Execution Model

### Topological Sort

The coordinator processes nodes in dependency order:

```
1. Find all nodes with no unmet dependencies → Ready Set
2. Dispatch ready nodes in parallel
3. When a node completes, update dependency status
4. Repeat until all nodes complete or error
```

### Node States

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> ready: Dependencies met
    ready --> dispatched: Agent selected
    dispatched --> running: Work started
    running --> success: Result received
    running --> failed: Error/timeout
    failed --> ready: Retry
    failed --> [*]: Max retries
    success --> [*]
```

| State | Description |
|-------|-------------|
| `pending` | Waiting for dependencies |
| `ready` | All dependencies complete |
| `dispatched` | Sent to agent |
| `running` | Agent is processing |
| `success` | Completed successfully |
| `failed` | Error or timeout |
| `skipped` | Skipped due to upstream failure |
| `timeout` | Exceeded deadline |

---

## Input Mappings

### JSONPath Syntax

Input mappings use JSONPath to reference parent outputs:

```
$.{nodeName}.result.{path}
```

### Examples

| Mapping | Description |
|---------|-------------|
| `$.fetch.result.body` | Body from fetch result |
| `$.analyze.result.scores[0]` | First score |
| `$.parse.result.data.name` | Nested field |

### Resolution

At dispatch time:

```typescript
const inputs = {
  ...node.payload,  // Static values
  ...resolveInputMappings(node.inputMappings, parentOutputs),
};
```

### Parent Outputs

The `parents` field in dispatch payload contains all parent results:

```json
{
  "inputs": {
    "text": "<resolved from $.extract.result.text>"
  },
  "parents": {
    "fetch": { "result": { "body": "..." } },
    "extract": { "result": { "text": "..." } }
  }
}
```

---

## Targeted Routing

### Direct Agent Dispatch

Skip discovery and route directly to a specific agent:

```json
{
  "nodes": {
    "task": {
      "capabilityId": "cap.text.generate.v1",
      "targetAgentId": "did:noot:my-preferred-agent",
      "allowBroadcastFallback": false
    }
  }
}
```

### Behavior

| targetAgentId | allowBroadcastFallback | Behavior |
|---------------|------------------------|----------|
| Not set | - | Normal broadcast discovery |
| Set | `false` | Fail if agent unavailable |
| Set | `true` | Try target, fall back to broadcast |

### Error: AGENT_UNAVAILABLE

```json
{
  "error": "AGENT_UNAVAILABLE",
  "targetAgentId": "did:noot:...",
  "details": "agent_offline"
}
```

---

## Parallel Execution

Nodes with no mutual dependencies run concurrently:

```mermaid
gantt
    title Parallel Execution
    dateFormat X
    axisFormat %s
    
    section Phase 1
    fetch: 0, 2
    
    section Phase 2
    summarize: 2, 4
    sentiment: 2, 3
    
    section Phase 3
    report: 4, 6
```

The coordinator maintains a ready queue and dispatches as capacity allows.

---

## Verification

Nodes can require verification before settlement:

```json
{
  "nodes": {
    "generate": {
      "capabilityId": "cap.text.generate.v1",
      "requiresVerification": true
    }
  }
}
```

When enabled:

1. Primary agent produces result
2. Verification agent validates output
3. If approved → settlement proceeds
4. If rejected → retry or fail

---

## Budget Control

### Workflow Budget

```json
{
  "settings": {
    "maxBudgetCredits": 100
  }
}
```

The coordinator:

1. Estimates total cost from capability prices
2. Reserves budget at workflow start
3. Deducts as nodes complete
4. Fails nodes if budget exceeded

### Node-Level Pricing

Capabilities have registered prices:

```json
{
  "capabilityId": "cap.text.summarize.v1",
  "price_cents": 5
}
```

---

## Error Handling

### Retry Policy

```json
{
  "nodes": {
    "unreliable": {
      "capabilityId": "cap.external.api.v1",
      "maxRetries": 3,
      "timeoutMs": 30000
    }
  }
}
```

Retry backoff: `[0s, 1s, 5s, 30s]`

### Failure Propagation

By default, node failures propagate:

- Downstream nodes are marked `skipped`
- Workflow status becomes `failed`

Future: Allow `continueOnFailure` for resilient workflows.

---

## Publishing

### API

```bash
curl -X POST https://coord.nooterra.ai/v1/workflows/publish \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "intent": "...",
    "nodes": { ... }
  }'
```

### Response

```json
{
  "workflowId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "taskId": "a1b2c3d4-...",
  "status": "pending"
}
```

### Polling Status

```bash
curl https://coord.nooterra.ai/v1/workflows/{workflowId}
```

---

## LLM-Based Planning

The coordinator can generate workflows from natural language:

```bash
curl -X POST https://coord.nooterra.ai/v1/workflows/suggest \
  -H "Content-Type: application/json" \
  -H "x-api-key: playground-free-tier" \
  -d '{
    "description": "Fetch the latest HackerNews headlines and summarize them"
  }'
```

Response:

```json
{
  "draft": {
    "intent": "Fetch and summarize HackerNews headlines",
    "nodes": {
      "fetch_hn": {
        "capabilityId": "cap.http.fetch.v1",
        "payload": { "url": "https://news.ycombinator.com" }
      },
      "extract_headlines": {
        "capabilityId": "cap.text.extract.v1",
        "dependsOn": ["fetch_hn"]
      },
      "summarize": {
        "capabilityId": "cap.text.summarize.v1",
        "dependsOn": ["extract_headlines"]
      }
    }
  }
}
```

---

## See Also

- [Dispatch Contract](dispatch.md)
- [Settlement & Escrow](settlement.md)
- [Targeted Routing Guide](../guides/targeted-routing.md)
