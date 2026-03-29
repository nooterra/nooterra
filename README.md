<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Nooterra" src=".github/assets/banner-dark.svg" width="560">
  </picture>
</p>

<p align="center">
  <b>The operating system for autonomous businesses.</b><br>
  Describe your business. Get a team of AI workers that run your operations 24/7.
</p>

<p align="center">
  <a href="https://nooterra.ai"><img src="https://img.shields.io/badge/app-nooterra.ai-c4613a" alt="App"></a>
  <a href="https://docs.nooterra.ai"><img src="https://img.shields.io/badge/docs-nooterra.ai-6366f1" alt="Docs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
</p>

<br>

## What Is Nooterra

You describe your business in one sentence. Nooterra builds you a team of AI workers &mdash; each with explicit permissions, approval flows, and audit trails &mdash; that handle your daily operations.

**Workers don't just chat. They take real actions:** read emails, draft replies, look up billing, schedule appointments, manage reviews, send invoices. Every action is governed by a charter that defines what they can do autonomously, what needs your approval, and what's permanently off-limits.

<br>

## Quick Start

### Web (recommended)

1. Go to **[nooterra.ai](https://nooterra.ai)**
2. Describe your business
3. Review your AI team
4. Activate

### CLI

```sh
npx nooterra
```

<br>

## How It Works

**1. Describe your business.** "I run a plumbing company in Denver with 8 technicians." Nooterra designs a team of AI workers tailored to your operations.

**2. Every worker gets a charter.** Explicit authority boundaries enforced at runtime &mdash; not prompt instructions.

| Permission | What happens | Example |
|---|---|---|
| **canDo** | Runs autonomously | Read emails, search FAQ, draft replies |
| **askFirst** | Pauses for your approval | Issue refunds, send external emails |
| **neverDo** | Hard-blocked, no exceptions | Delete data, share PII, exceed budget |

**3. You stay in control.** When a worker hits an `askFirst` action, it pauses and routes to you with full context &mdash; the draft, the source data, and its reasoning. Approve, edit, or reject.

**4. Everything is audited.** Every action, tool call, and decision is recorded. You see exactly what happened, when, and why.

<br>

## Features

- **Governed AI workers** &mdash; Runtime-enforced charters with fail-closed defaults
- **Human approval flows** &mdash; Multi-channel (web, Slack, terminal). First response wins
- **Any AI provider** &mdash; ChatGPT, Claude, Gemini, Groq, OpenRouter. Swap anytime
- **Real integrations** &mdash; Gmail, Slack, Stripe, Calendar, GitHub, and more
- **Runs 24/7** &mdash; Cron schedules, webhook triggers, or continuous operation
- **Full audit trail** &mdash; Every action logged with cost tracking
- **Web dashboard** &mdash; Create teams, manage workers, review inbox, monitor activity
- **CLI & TUI** &mdash; Terminal-based management for developers
- **MCP support** &mdash; Use from Claude Desktop, Cursor, or any MCP client

<br>

## Architecture

```
 nooterra.ai (dashboard)
       │
       ▼
 Scheduler Service (Railway)
       │
   ┌───┴───┐
   │       │
ChatGPT  OpenRouter ─── Claude, Gemini, Groq, ...
   │
   ▼
 Workers execute via tool integrations
 (Gmail, Slack, Stripe, Calendar, ...)
       │
       ▼
 Charter enforcement ── canDo / askFirst / neverDo
       │
       ▼
 Approval routing ── Web inbox, Slack, webhooks
```

<br>

## MCP Integration

Use Nooterra from Claude Desktop, Cursor, or any MCP client:

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

## Documentation

Full docs at **[docs.nooterra.ai](https://docs.nooterra.ai)**

<br>

## Community

- [Discord](https://discord.gg/nooterra)
- [Twitter / X](https://twitter.com/nooterra)
- [nooterra.ai](https://nooterra.ai)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
