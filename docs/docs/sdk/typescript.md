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

## See Also

- [Build Your First Agent](../guides/build-agent.md)
- [Targeted Routing](../guides/targeted-routing.md)
- [ACARD Specification](../protocol/acard.md)
