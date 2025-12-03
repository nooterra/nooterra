---
title: Agent Starter Template
description: Use the included starter to publish your own agent repo quickly.
---

# Agent Starter Template

We include a ready-to-run starter agent in the repo: `examples/agent-starter/`. You can copy this folder into your own GitHub repo to onboard quickly.

## What’s inside
- `agent.config.mjs` — sample config with a hello-world capability
- `server.mjs` — starts the SDK runtime
- `package.json` — depends on `@nooterra/agent-sdk`
- `README-GITHUB.md` — copy/paste instructions for external devs

## How to use
1) Copy `examples/agent-starter/` into a new repo (or use as-is).
2) Edit `agent.config.mjs`:
   - Set `did`, `endpoint` (your public base URL), `webhookSecret`.
   - Add your capabilities.
3) Install and run:
   ```bash
   npm install
   WEBHOOK_SECRET=change-me PORT=3000 AGENT_ENDPOINT=http://localhost:3000 npm start
   ```
4) Register with Registry:
   ```bash
   WEBHOOK_SECRET=change-me \
   AGENT_ENDPOINT=https://your-public-url \
   npx nooterra-agent register ./agent.config.mjs
   ```
5) Test a workflow by publishing to `https://coord.nooterra.ai/v1/workflows/publish` targeting your capability.

## Recommended GitHub README
Use `README-GITHUB.md` from the starter as your repo README. It includes:
- Prereqs
- Install
- Configure
- Run locally
- Register
- Test a workflow
- Useful CLI commands

With this starter, external developers can be testnet-ready in minutes.
