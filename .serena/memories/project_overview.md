## Purpose
- Nooterra is a coordination protocol/network for AI agents to discover each other, form DAG workflows, execute tasks, verify outputs, and settle payments.
- Components: Coordinator (workflow orchestration, ledger/escrow, auctions, policy, recovery, metrics), Registry (ACARD+capabilities, semantic discovery, reputation/availability), Console (React console/marketing+playground), Sandbox Runner (code verification sandbox), SDKs/CLI/adapters (TS, Python, MCP, LangChain, Eliza, Semantic Kernel), examples and infra scripts.

## Architecture highlights
- Coordinator (apps/coordinator, Fastify):
  - Workflow publish/suggest/dispatch with DAG tracking (tasks/workflows/task_nodes tables). Targeted routing and policy filters; selection logs for observability.
  - Dispatcher worker processes dispatch_queue; supports adapters (HuggingFace/OpenAI/Replicate/Ollama/Bittensor/webhooks), budget reservation/confirmation, retries/backoff, circuit breaker + recovery engine and fault detector (timeout/error/schema) driving refunds/reputation.
  - Ledger + balances, payments, staking, reputation/endorsements, alerts/metrics, memory/events streaming, templates, policy enforcement, project/API key management, auth (email + SIWE), auctions optional, scheduled workflows.
  - DB via pg with large schema migration in db.ts; utilities for redis/queue, schema validation, services for metrics/policy/budget/fault/recovery.
- Registry (apps/registry, Fastify + Postgres + Qdrant + @xenova/transformers): agent register with ACARD validation/signature; semantic discovery (vector + keyword fallback) with reputation/availability scoring; heartbeat/reputation/availability updates; capability schema lookup; admin reindex; rate limiting and optional API key guard.
- Sandbox Runner (apps/sandbox-runner): Fastify service exposing /verify; executes JS/TS snippets in restricted child_process with output trimming, forbidden patterns, resource/time limits.
- Console (apps/console, Vite React + Tailwind + wagmi): marketing + dashboard + dev/org/user flows; routes defined in src/routes.tsx; AuthContext implements SIWE wallet login hitting coordinator auth endpoints; numerous UI components/hero sections.
- CLI (apps/cli): commander-based `nooterra` tool for init scaffolds (python/node/docker/rust), wallet connect/balance/withdraw, deploy, logs/status; interacts with registry/coordinator.
- Agent SDK (packages/agent-sdk): startAgentServer verifies webhook HMAC, dispatches to capability handlers, posts signed node results; heartbeat; register agent; helper to publish workflows; crypto helpers.
- Core SDK (packages/core): lightweight HTTP client for registry/coordinator (register, discovery, publish task/workflow, ledger/feedback/balances).
- Types package (packages/types): shared TS domain types (workflow, capability, policy, ledger, trust, identity, etc.).
- Adapters/integrations: LangChain adapter tool builders; MCP bridge exposing capabilities as tools; Eliza plugin actions for search/hire/status; Semantic Kernel C# plugin; Python SDK (sync/async + agent server) with integrations for autogen/crewai/llamaindex/pydanticai.
- Examples: numerous agent demos (browser, github, slack, huggingface, langgraph, hermes, TTS, etc.), workflow simulations (coldchain, travel-coalition), webhook listener, starter agents.
- Infra/scripts: e2e live tests and helpers to register agents/HF models, workflow demos; Railway/Vercel deploy configs; Dockerfiles for services.

## Tooling/stack
- Monorepo with pnpm + turbo, TypeScript (Node 20), Fastify backend, Postgres, Qdrant, Redis, Vite/React frontend, vitest for coordinator, Drizzle migrations (CLI), Tailwind.
- CI (GitHub Actions): pnpm type-check, lint, build, test; Docker builds for coordinator/registry/sandbox-runner; release publishes packages and Docker images.
