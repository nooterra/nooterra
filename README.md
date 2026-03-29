<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Nooterra" src=".github/assets/banner-dark.svg" width="480">
  </picture>
</p>

<h3 align="center">Describe your business. We staff it.</h3>

<p align="center">
  One sentence turns into a team of AI workers that handle your operations<br>
  — emails, scheduling, billing, reputation — 24/7, with rules they can't break.
</p>

<p align="center">
  <a href="https://nooterra.ai/signup"><strong>Start free</strong></a> · <a href="https://docs.nooterra.ai">Docs</a> · <a href="https://discord.gg/nooterra">Discord</a>
</p>

<p align="center">
  <a href="https://nooterra.ai"><img src="https://img.shields.io/badge/nooterra.ai-c4613a?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iNCIvPjwvc3ZnPg==&logoColor=white" alt="App"></a>
  <a href="https://docs.nooterra.ai"><img src="https://img.shields.io/badge/docs-nooterra.ai-1a1a2e?style=flat-square" alt="Docs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
</p>

<br>

---

<br>

## How it works

```
  "I run a plumbing company in Denver with 8 technicians"
```

Nooterra analyzes your business and builds a team:

```
  ┌─────────────────────────────────────────────────────────┐
  │  Reception Worker                                       │
  │                                                         │
  │  canDo     Read emails, answer FAQs, book appointments  │
  │  askFirst  Reschedule existing jobs, quote prices        │
  │  neverDo   Cancel jobs without approval, share PII       │
  │                                                         │
  │  Schedule: continuous · Model: gpt-5.4-mini             │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │  Billing Worker                                         │
  │                                                         │
  │  canDo     Generate invoices, send reminders            │
  │  askFirst  Issue refunds, adjust pricing                │
  │  neverDo   Delete records, exceed discount limits       │
  │                                                         │
  │  Schedule: 0 9 * * * · Model: claude-haiku-4.5          │
  └─────────────────────────────────────────────────────────┘
```

Workers take **real actions** — not chat responses. Every action is classified against the charter at runtime. Unknown actions are **blocked by default**.

<br>

## The permission model

| | What happens | Enforcement |
|---|---|---|
| **canDo** | Worker acts autonomously | Real-time charter match |
| **askFirst** | Worker pauses, routes to you with full context | Multi-channel approval (web, Slack, terminal) |
| **neverDo** | Hard-blocked, regardless of what the model says | Fail-closed, no override |

This is not prompt engineering. The charter is enforced at the **action layer**, after the model generates intent but before any tool executes.

<br>

## Get started

### Web (recommended)

Go to **[nooterra.ai](https://nooterra.ai)** → describe your business → review team → activate.

### CLI

```sh
npx nooterra
```

### MCP (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "nooterra": {
      "command": "npx",
      "args": ["-y", "nooterra", "mcp"]
    }
  }
}
```

<br>

## What workers can connect to

| Integration | Actions |
|---|---|
| **Gmail** | Read inbox, draft replies, send emails |
| **Calendar** | Check availability, book appointments |
| **Slack** | Send messages, read channels, post updates |
| **Stripe** | Look up customers, check billing, issue refunds |
| **GitHub** | Read issues, create PRs, review code |
| **Web** | Fetch pages, search, extract data |

More integrations ship continuously. Workers use tools through governed MCP connections.

<br>

## Architecture

```
  nooterra.ai (React dashboard)
          │
          ▼
  Scheduler Service (Railway)
          │
    ┌─────┴──────┐
    │            │
  ChatGPT    OpenRouter ─── Claude, Gemini, Groq, ...
    │
    ▼
  Tool Execution (MCP)
  Gmail · Slack · Stripe · Calendar · GitHub · Web
          │
          ▼
  Charter Enforcement ─── canDo / askFirst / neverDo
          │
          ▼
  Approval Routing ─── Dashboard inbox · Slack · Webhooks
```

<br>

## Why this matters

Most AI tools stop at **chat**. They generate text about what they *would* do.

Nooterra workers **do the work** — and the charter system means you can actually trust them to. Every action is governed, every decision is audited, every approval is tracked.

The long game: a single business owner runs the operation of a 50-person company with a team of AI workers. Not by replacing people with chatbots, but by deploying governed agents that earn autonomy over time.

<br>

## Links

| | |
|---|---|
| **App** | [nooterra.ai](https://nooterra.ai) |
| **Docs** | [docs.nooterra.ai](https://docs.nooterra.ai) |
| **Discord** | [discord.gg/nooterra](https://discord.gg/nooterra) |
| **Twitter** | [@nooterra](https://twitter.com/nooterra) |

<br>

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
