<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Nooterra" src=".github/assets/banner-dark.svg" width="480">
  </picture>
</p>

<h3 align="center">The Enterprise World Runtime</h3>

<p align="center">
  The first executable company. A live model of your business that observes, predicts, and operates<br>
  through governed agents — earning autonomy from traced performance, not trust on faith.
</p>

<p align="center">
  <a href="https://nooterra.ai/signup"><strong>Start free</strong></a> ·
  <a href="https://docs.nooterra.ai">Docs</a> ·
  <a href="https://discord.gg/nooterra">Discord</a>
</p>

---

## What Nooterra does

You create AI workers with permission rules. Each worker has a charter that defines what it **can do** autonomously, what it must **ask first** about, and what it can **never do**. Workers take real actions — sending emails, making payments, scheduling meetings — and the charter is enforced at the action layer, after the model generates intent but before any tool executes.

Workers learn from their own execution history. Approval patterns feed back into trust levels. The system gets smarter the more you use it.

## The permission model

| | What happens | Enforcement |
|---|---|---|
| **canDo** | Worker acts autonomously | Real-time charter match |
| **askFirst** | Worker pauses, routes to you with full context | Multi-channel approval (web, Slack) |
| **neverDo** | Hard-blocked, regardless of what the model says | Fail-closed, no override |

## Get started

Go to **[nooterra.ai](https://nooterra.ai)** → create a worker → define its charter → activate.

## Architecture

```
Dashboard (Vercel)  →  Agent Runtime (Railway)  →  Postgres
                       Magic Link Auth (Railway)
```

- **Dashboard**: React + Vite frontend. Worker management, approval inbox, execution traces.
- **Agent Runtime**: Node.js service. LLM orchestration, charter enforcement, tool execution, learning signals.
- **Magic Link Auth**: Email OTP + passkey authentication.

## Self-hosting

```bash
git clone https://github.com/nooterra/nooterra
cd nooterra
cp .env.dev.example .env.dev
docker compose up -d
npm ci
npm run dev:runtime
```

Requires: Node.js 20, Postgres, Redis (optional).

## Development

```bash
npm run dev:runtime       # Agent runtime (port 8080)
npm run dev:magic-link    # Auth service
cd dashboard && npm run dev  # Dashboard (Vite)
```

### Testing

```bash
node --test test/runtime-*.test.js    # Runtime tests
npm run type-check                     # TypeScript
npm run lint                           # ESLint
```

## License

[Apache-2.0](./LICENSE)
