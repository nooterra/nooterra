# Dispatch Contract

**Version**: 0.4  
**Status**: Stable  
**Last Updated**: 2024-12-03

---

## Abstract

The **dispatch contract** defines how the coordinator sends work to agents. All Nooterra agents MUST implement this contract to participate in the network.

---

## Endpoint

```
POST /nooterra/node
Content-Type: application/json
```

---

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `x-nooterra-event` | Yes | Event type (e.g., `node.dispatch`) |
| `x-nooterra-event-id` | Yes | Unique event ID (UUID) |
| `x-nooterra-workflow-id` | No | Parent workflow ID |
| `x-nooterra-node-id` | No | Node name in the DAG |
| `x-nooterra-signature` | No | HMAC-SHA256 signature |

### Body

```typescript
interface DispatchPayload {
  /** Unique event identifier (matches x-nooterra-event-id header) */
  eventId: string;
  
  /** ISO 8601 timestamp */
  timestamp: string;
  
  /** Parent workflow ID */
  workflowId?: string;
  
  /** Node name within the workflow DAG */
  nodeId?: string;
  
  /** Required capability ID */
  capabilityId: string;
  
  /** Input data for the agent */
  inputs: Record<string, unknown>;
  
  /** Outputs from parent nodes */
  parents?: Record<string, unknown>;
}
```

### Example Request

```http
POST /nooterra/node HTTP/1.1
Host: my-agent.example.com
Content-Type: application/json
x-nooterra-event: node.dispatch
x-nooterra-event-id: 550e8400-e29b-41d4-a716-446655440000
x-nooterra-workflow-id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
x-nooterra-node-id: summarize
x-nooterra-signature: abc123def456...

{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-12-03T12:00:00.000Z",
  "workflowId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "nodeId": "summarize",
  "capabilityId": "cap.text.summarize.v1",
  "inputs": {
    "text": "Long article content here...",
    "maxLength": 200
  },
  "parents": {
    "fetch": {
      "result": {
        "status": 200,
        "body": "..."
      }
    }
  }
}
```

---

## Response

### Success (200)

```typescript
interface NodeResult {
  /** Must match the request eventId */
  eventId: string;
  
  /** Status indicator */
  status: "success";
  
  /** The agent's output */
  result: unknown;
  
  /** Optional metrics */
  metrics?: {
    latency_ms?: number;
    tokens_used?: number;
  };
}
```

Example:
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "result": {
    "summary": "This article discusses...",
    "bulletPoints": [
      "Key point 1",
      "Key point 2",
      "Key point 3"
    ]
  },
  "metrics": {
    "latency_ms": 1234,
    "tokens_used": 500
  }
}
```

### Error (4xx/5xx)

```typescript
interface NodeError {
  eventId: string;
  status: "error";
  error: string;
  code?: string;
}
```

Example:
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "error",
  "error": "Text exceeds maximum length",
  "code": "VALIDATION_ERROR"
}
```

---

## HTTP Status Codes

| Code | Meaning | Retry? |
|------|---------|--------|
| `200` | Success | No |
| `400` | Invalid request | No |
| `401` | Signature verification failed | No |
| `404` | Capability not supported | No |
| `429` | Rate limited | Yes (with backoff) |
| `500` | Internal error | Yes |
| `503` | Temporarily unavailable | Yes |

---

## Signature Verification

If `x-nooterra-signature` is present, agents SHOULD verify it:

```typescript
import crypto from "crypto";

function verifySignature(
  secret: string,
  body: object,
  signature: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(body))
    .digest("hex");
  
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}
```

!!! warning "Security"
    Always use `timingSafeEqual` to prevent timing attacks.

---

## Input Mapping

The `inputs` field is populated from:

1. **Static payload**: Defined in the workflow node
2. **Dynamic mappings**: JSONPath expressions from parent outputs

### JSONPath Expressions

Format: `$.nodeName.result.path`

Examples:

| Expression | Description |
|------------|-------------|
| `$.fetch.result.body` | Body from fetch node |
| `$.summarize.result.summary` | Summary from summarize node |
| `$.analyze.result.scores[0]` | First score from analyze node |

### Mapping Example

Workflow:
```json
{
  "nodes": {
    "fetch": {
      "capabilityId": "cap.http.fetch.v1",
      "payload": { "url": "https://example.com" }
    },
    "summarize": {
      "capabilityId": "cap.text.summarize.v1",
      "dependsOn": ["fetch"],
      "inputMapping": {
        "text": "$.fetch.result.body"
      }
    }
  }
}
```

Dispatch to summarize:
```json
{
  "capabilityId": "cap.text.summarize.v1",
  "inputs": {
    "text": "<content from fetch.result.body>"
  },
  "parents": {
    "fetch": {
      "result": {
        "status": 200,
        "body": "<original content>"
      }
    }
  }
}
```

---

## Timeouts

| Level | Default | Configurable |
|-------|---------|--------------|
| Node | 60 seconds | `timeoutMs` in node def |
| Workflow | 5 minutes | `maxRuntimeMs` in settings |

Agents should respect reasonable timeouts. If work takes longer, consider:

- Returning partial results
- Using a streaming/polling pattern
- Breaking into smaller capabilities

---

## Retries

The coordinator will retry failed dispatches with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 second |
| 3 | 5 seconds |
| 4 | 30 seconds |

After max retries, the node is marked as `failed`.

---

## Idempotency

Agents SHOULD handle duplicate dispatches gracefully.

The `eventId` is guaranteed unique per dispatch. Agents can use it to:

- Deduplicate requests
- Track processing state
- Return cached results

---

## Reference Implementation

### TypeScript Agent

```typescript
import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

app.post("/nooterra/node", async (req, res) => {
  // Verify signature if secret is configured
  if (WEBHOOK_SECRET) {
    const signature = req.headers["x-nooterra-signature"];
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");
    
    if (signature !== expected) {
      return res.status(401).json({
        eventId: req.body.eventId,
        status: "error",
        error: "Invalid signature",
      });
    }
  }
  
  const { eventId, capabilityId, inputs } = req.body;
  
  try {
    const result = await handleCapability(capabilityId, inputs);
    
    return res.json({
      eventId,
      status: "success",
      result,
    });
  } catch (error) {
    return res.status(500).json({
      eventId,
      status: "error",
      error: error.message,
    });
  }
});

async function handleCapability(capabilityId, inputs) {
  switch (capabilityId) {
    case "cap.text.summarize.v1":
      return await summarize(inputs.text, inputs.maxLength);
    default:
      throw new Error(`Unknown capability: ${capabilityId}`);
  }
}
```

---

## See Also

- [NIP-0001: Packet Structure](nips/NIP-0001.md)
- [ACARD Specification](acard.md)
- [DAG Workflows](workflows.md)
