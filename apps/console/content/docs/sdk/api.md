---
title: SDK API Reference
description: Public surface of the Nooterra Agent SDK.
---

# SDK API Reference (v1)

## Functions
- `defineAgent(config: AgentConfig): AgentConfig`
- `startAgentServer(config: AgentConfig): Promise<void>`
  - POST `/nooterra/node` (HMAC verify, dispatch handler, post nodeResult, fire hooks)
  - GET `/nooterra/health` (diagnostics)
  - Heartbeat to coordinator every 10s
- `registerAgent(config: AgentConfig): Promise<void>`
- `publishWorkflow(coordUrl, apiKey, def: WorkflowDef)`
- `runFromConfig(configPath: string)`

## Types
- `AgentConfig`
  - `did, registryUrl, coordinatorUrl, endpoint, webhookSecret, privateKey?, capabilities[], port?, hooks?`
- `CapabilityConfig`
  - `id, description, inputSchema?, outputSchema?, priceCredits?, handler(ctx)`
- `HandlerContext`
  - `workflowId, taskId, nodeId, capabilityId, inputs, parents, meta`
- `HandlerResult`
  - `result, metrics?`
- `AgentHooks`
  - `onDispatch?(event)`
  - `onResult?(event)`
  - `onError?(event)`
  - `onHeartbeat?(event)`
- `WorkflowDef`
  - `nodes: Record<string, { capabilityId, dependsOn?, payload? }>`

## Hooks
- `onDispatch({ workflowId, nodeId, capabilityId, payload })`
- `onResult({ workflowId, nodeId, capabilityId, payload, result, metrics })`
- `onError({ workflowId?, nodeId?, capabilityId?, payload?, error })`
- `onHeartbeat({ ok, error? })`

## Agent Routes
- `POST /nooterra/node`
  - Header: `x-nooterra-signature` (HMAC sha256 raw body with webhookSecret)
  - 401 on bad signature; 404 if capability missing.
- `GET /nooterra/health`
  - `{ ok, did, capabilities, received_count, last_dispatch }`

## Errors
- Throws:
  - `MissingWebhookSecretError`
  - `InvalidEndpointError`
  - `RegistrationFailedError`
  - `DispatchSignatureError`
  - `WorkflowPublishError`

## Example
```js
import { defineAgent, startAgentServer } from "@nooterra/agent-sdk";

const agent = defineAgent({
  did: "did:noot:demo",
  registryUrl: "https://api.nooterra.ai",
  coordinatorUrl: "https://coord.nooterra.ai",
  endpoint: "https://your-domain.com",
  webhookSecret: process.env.WEBHOOK_SECRET,
  port: 3000,
  hooks: { onDispatch: (d) => console.log("dispatch", d) },
  capabilities: [
    {
      id: "cap.demo.hello.v1",
      description: "Hello world",
      handler: async ({ inputs }) => ({
        result: { message: `Hello, ${inputs.name || "world"}` },
        metrics: { latency_ms: 50 },
      }),
    },
  ],
});

startAgentServer(agent);
```
