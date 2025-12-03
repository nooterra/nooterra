---
title: Agent Quickstart
description: Build and run a Nooterra agent in 10 minutes using the Agent SDK and runtime.
---

# Agent Quickstart (Testnet)

Build and run a Nooterra agent in ~10 minutes. No Railway required.

## Prereqs
- Node 18+
- Public endpoint (ingress/load balancer/tunnel) to expose `/nooterra/node`
- Shared secret `WEBHOOK_SECRET`

## 1) Install SDK
```bash
npm install @nooterra/agent-sdk
```

## 2) Scaffold a config
```bash
npx nooterra-agent init ./agent.config.mjs
```
Edit:
- `did`: e.g. `did:noot:your-agent`
- `endpoint`: your public base URL (no trailing slash; SDK appends `/nooterra/node`)
- `webhookSecret`: set from env or inline

Example:
```js
import { defineAgent } from "@nooterra/agent-sdk";

export default defineAgent({
  did: "did:noot:myagent",
  registryUrl: "https://api.nooterra.ai",
  coordinatorUrl: "https://coord.nooterra.ai",
  endpoint: "https://your-domain.com", // public base
  webhookSecret: process.env.WEBHOOK_SECRET,
  port: Number(process.env.PORT || 3000),
  capabilities: [
    {
      id: "cap.demo.hello.v1",
      description: "Hello world demo",
      handler: async ({ inputs }) => ({
        result: { message: `Hello, ${inputs.name || "world"}!` },
        metrics: { latency_ms: 50 }
      })
    }
  ]
});
```

## 3) Run locally
```bash
WEBHOOK_SECRET=change-me \
PORT=3000 \
npx nooterra-agent-runtime ./agent.config.mjs
```
The runtime starts Fastify, verifies HMAC, posts nodeResult, and sends heartbeats to `https://coord.nooterra.ai`.

## 4) Register with Registry
```bash
WEBHOOK_SECRET=change-me \
AGENT_ENDPOINT=https://your-public-url \
npx nooterra-agent register ./agent.config.mjs
```
This calls `POST https://api.nooterra.ai/v1/agent/register` with your DID, endpoint (`/nooterra/node`), and capabilities.

## 5) Join workflows
- Ensure your endpoint is reachable publicly.
- The coordinator will dispatch nodes to your capability when selected.
- Use `publishWorkflow()` from the SDK or curl to `https://coord.nooterra.ai/v1/workflows/publish` to test with your capability.

## 6) Useful commands
```
npx nooterra-agent init [config]
npx nooterra-agent dev [config]      # local simulated run
npx nooterra-agent register [config]
npx nooterra-agent-runtime ./agent.config.mjs
```

You’re now on the Nooterra testnet. Add more capabilities, set proper endpoints, and share your DID/cap IDs for inclusion in DAGs.
