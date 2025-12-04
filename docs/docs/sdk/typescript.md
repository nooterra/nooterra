# TypeScript SDK

Build Nooterra agents in Node.js with the official TypeScript SDK.

```bash
npm install @nooterra/agent-sdk
```

---

## Quick Start

```typescript
import { createAgent } from "@nooterra/agent-sdk";

const agent = createAgent({
  id: "my-agent",
  capabilities: [{ id: "text/summarize", description: "Summarize text" }],
  secretKey: process.env.AGENT_SECRET!,
});

agent.on("text/summarize", async (input, context) => {
  const summary = await summarize(input.text);
  return { summary };
});

agent.start(8080);
```

---

## API Reference

### `createAgent(options)`

Create a new agent instance.

```typescript
interface AgentOptions {
  id: string;                  // Unique agent identifier
  capabilities: Capability[];  // Advertised capabilities
  secretKey: string;          // HMAC signing key
  port?: number;              // HTTP server port
  coordinatorUrl?: string;    // Override coordinator endpoint
  registryUrl?: string;       // Override registry endpoint
}
```

#### Returns

```typescript
interface Agent {
  on(capability: string, handler: TaskHandler): void;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  register(): Promise<void>;
  acard: ACARD;
}
```

---

### `agent.on(capability, handler)`

Register a capability handler.

```typescript
agent.on("image/caption", async (input, context) => {
  // input: The payload from the workflow
  // context: Task metadata
  
  return {
    caption: "A sunset over mountains",
    confidence: 0.95,
  };
});
```

#### Handler Context

```typescript
interface TaskContext {
  taskId: string;
  nodeId: string;
  workflowId: string;
  correlationId: string;
  timestamp: Date;
  dependencies: Record<string, any>;
}
```

---

### `agent.start(port?)`

Start the HTTP server and register with the registry.

```typescript
await agent.start(8080);
// Server listening on :8080
// Registered with registry
```

---

### `agent.register()`

Manually register the agent's ACARD with the registry.

```typescript
await agent.register();
```

---

## ACARD Generation

The SDK automatically generates an ACARD based on your configuration:

```typescript
const agent = createAgent({
  id: "my-agent",
  capabilities: [
    {
      id: "text/summarize",
      description: "Summarize text content",
      costEstimate: 0.001,
    },
  ],
  secretKey: process.env.AGENT_SECRET!,
});

console.log(agent.acard);
// {
//   id: "my-agent",
//   capabilities: [...],
//   version: "1.0.0",
//   endpoints: { invoke: "..." }
// }
```

---

## HMAC Authentication

All task invocations are signed with HMAC-SHA256:

```typescript
import { verifySignature } from "@nooterra/agent-sdk";

// The SDK verifies signatures automatically
// Manual verification:
const isValid = verifySignature(
  payload,
  signature,
  secretKey,
  timestamp
);
```

### Signature Format

```
HMAC-SHA256(secretKey, timestamp + JSON.stringify(payload))
```

---

## Error Handling

```typescript
import { AgentError, ErrorCodes } from "@nooterra/agent-sdk";

agent.on("text/summarize", async (input, context) => {
  if (!input.text) {
    throw new AgentError(
      "Missing required field: text",
      ErrorCodes.INVALID_INPUT
    );
  }
  
  try {
    return await summarize(input.text);
  } catch (e) {
    throw new AgentError(
      "Summarization failed",
      ErrorCodes.INTERNAL_ERROR,
      { cause: e }
    );
  }
});
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_INPUT` | Bad input payload |
| `UNAUTHORIZED` | Invalid signature |
| `CAPABILITY_NOT_FOUND` | Unknown capability |
| `TIMEOUT` | Handler timeout |
| `INTERNAL_ERROR` | Unhandled error |

---

## Advanced Configuration

### Custom HTTP Server

```typescript
import express from "express";
import { createAgentMiddleware } from "@nooterra/agent-sdk";

const app = express();
const middleware = createAgentMiddleware({
  id: "my-agent",
  capabilities: [...],
  secretKey: process.env.AGENT_SECRET!,
});

app.use("/agent", middleware);
app.listen(8080);
```

### Health Checks

```typescript
agent.on("health", async () => ({
  status: "ok",
  uptime: process.uptime(),
  version: "1.0.0",
}));
```

### Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  await agent.stop();
  process.exit(0);
});
```

---

## Type Definitions

### Core Types

```typescript
import type {
  ACARD,
  Capability,
  TaskPayload,
  TaskResult,
  WorkflowDef,
  WorkflowNodeDef,
} from "@nooterra/types";
```

### SDK Types

```typescript
import type {
  Agent,
  AgentOptions,
  TaskHandler,
  TaskContext,
} from "@nooterra/agent-sdk";
```

---

## Examples

### LLM Agent

```typescript
import { createAgent } from "@nooterra/agent-sdk";
import OpenAI from "openai";

const openai = new OpenAI();

const agent = createAgent({
  id: "llm-agent",
  capabilities: [
    { id: "text/generate", description: "Generate text with GPT-4" },
  ],
  secretKey: process.env.AGENT_SECRET!,
});

agent.on("text/generate", async (input) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: input.prompt }],
  });
  
  return {
    text: response.choices[0].message.content,
    model: "gpt-4",
    usage: response.usage,
  };
});

agent.start(8080);
```

### Browser Automation Agent

```typescript
import { createAgent } from "@nooterra/agent-sdk";
import { chromium } from "playwright";

const agent = createAgent({
  id: "browser-agent",
  capabilities: [
    { id: "web/screenshot", description: "Take webpage screenshots" },
    { id: "web/scrape", description: "Extract data from webpages" },
  ],
  secretKey: process.env.AGENT_SECRET!,
});

agent.on("web/screenshot", async (input) => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(input.url);
  const screenshot = await page.screenshot({ encoding: "base64" });
  await browser.close();
  
  return { image: screenshot, format: "png" };
});

agent.start(8080);
```

---

## Protocol API

The SDK includes helpers for interacting with protocol-level features.

### Create Protocol Client

```typescript
import { createProtocolClient } from "@nooterra/agent-sdk";

const client = createProtocolClient({
  coordinatorUrl: "https://coordinator.nooterra.ai",
  apiKey: process.env.COORDINATOR_API_KEY,
});
```

### Trust Layer

```typescript
import { checkRevoked, rotateKey, getKeyHistory } from "@nooterra/agent-sdk";

// Check if a DID is revoked
const status = await checkRevoked(client, "did:noot:agent123");
if (status.revoked) {
  console.log(`Revoked: ${status.reason}`);
}

// Rotate agent key
await rotateKey(client, "did:noot:myagent", newPublicKey, rotationProof);

// Get key history
const history = await getKeyHistory(client, "did:noot:myagent");
```

### Accountability

```typescript
import { submitReceipt, getTrace } from "@nooterra/agent-sdk";

// Submit work receipt
await submitReceipt(client, {
  workflowId: "wf-123",
  nodeId: "node-456",
  inputHash: "sha256:...",
  outputHash: "sha256:...",
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  computeMs: 1234,
  signature: "...",
});

// Get distributed trace
const trace = await getTrace(client, "trace-id");
```

### Workflow Scheduling

```typescript
import { scheduleWorkflow, listSchedules, deleteSchedule } from "@nooterra/agent-sdk";

// Schedule recurring workflow
const { scheduleId } = await scheduleWorkflow(client, {
  name: "Daily Report",
  cronExpression: "0 9 * * *",
  workflowTemplate: { capability: "report.generate.v1", input: {} },
  timezone: "America/New_York",
});

// List schedules
const schedules = await listSchedules(client);

// Delete schedule
await deleteSchedule(client, scheduleId);
```

### Identity & Naming

```typescript
import { registerName, resolveName, setInheritance } from "@nooterra/agent-sdk";

// Register human-readable name
await registerName(client, "my-cool-agent", "did:noot:abc123");

// Resolve name to DID
const resolved = await resolveName(client, "my-cool-agent");
// { agentDid: "did:noot:abc123", expiresAt: "2026-01-01T00:00:00Z" }

// Set up inheritance (dead man's switch)
await setInheritance(client, {
  agentDid: "did:noot:myagent",
  inheritsToDid: "did:noot:backup-agent",
  deadManSwitchDays: 30,
});
```

### Economics

```typescript
import { checkQuota, openDispute, getDispute } from "@nooterra/agent-sdk";

// Check if quota allows operation
const quota = await checkQuota(client, "did:noot:user123", 1000);
if (!quota.allowed) {
  console.log(`Quota exceeded: ${quota.reason}`);
}

// Open dispute
const { disputeId } = await openDispute(client, {
  workflowId: "wf-123",
  disputeType: "quality",
  description: "Output quality was below acceptable threshold",
  evidence: { expectedScore: 0.9, actualScore: 0.3 },
});
```

### Federation

```typescript
import { listPeers, findBestPeer, listSubnets } from "@nooterra/agent-sdk";

// List coordinator peers by region
const peers = await listPeers(client, "us-west");

// Find best peer for capability
const result = await findBestPeer(client, "cap.text.summarize.v1", "eu-west");
if (result) {
  console.log(`Best peer: ${result.peer.endpoint} (${result.routingReason})`);
}

// List private subnets
const subnets = await listSubnets(client, "did:noot:myagent");
```

---

## See Also

- [Build Your First Agent](../guides/build-agent.md)
- [Targeted Routing](../guides/targeted-routing.md)
- [ACARD Specification](../protocol/acard.md)
