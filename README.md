<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Nooterra" src=".github/assets/banner-dark.svg" width="560">
  </picture>
</p>

<p align="center">
  <b>AI workers for consequential work.</b><br>
  Create workers in plain English. They run 24/7 with guardrails, approvals, and audit trails.
</p>

<p align="center">
  <a href="https://github.com/nooterra/nooterra/actions/workflows/tests.yml"><img src="https://github.com/nooterra/nooterra/actions/workflows/tests.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/nooterra"><img src="https://img.shields.io/npm/v/nooterra" alt="npm"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
  <a href="https://nooterra.ai/docs"><img src="https://img.shields.io/badge/docs-nooterra.ai-6366f1" alt="Docs"></a>
</p>

<!-- <p align="center"><img src=".github/assets/demo.gif" width="640" alt="Nooterra demo"></p> -->

<br>

## Quick Start

```sh
npm install -g nooterra
nooterra
```

Describe what you need. A governed worker deploys in seconds:

```
> I need a support worker that handles billing questions, looks up
  customers in Stripe, and drafts refund replies

  ⚡ Customer Support Worker

  ╭──────────────────────────────────────────────────╮
  │  Can do:    Read emails, Look up billing,        │
  │             Draft replies, Search FAQ             │
  │  Ask first: Issue refunds, Send communications   │
  │  Never do:  Share customer data, Make up info     │
  ╰──────────────────────────────────────────────────╯

  Tools: Email, Stripe, Slack · Schedule: continuous

  Deploy? yes
  ✓ Worker deployed!
```

<br>

## Why Nooterra

Most AI tools stop at chat. Nooterra workers take **real actions** &mdash; and that requires trust infrastructure that doesn't exist anywhere else.

| | Raw LLM / ChatGPT | Custom Agent Code | Automation (Zapier) | **Nooterra** |
|---|:---:|:---:|:---:|:---:|
| Natural language setup | Yes | No | No | **Yes** |
| Takes real actions | No | Yes | Yes | **Yes** |
| Runtime-enforced guardrails | No | Manual | No | **Yes** |
| Human approval flows | No | Manual | Limited | **Yes** |
| Audit trail for every action | No | Manual | Partial | **Yes** |
| Runs 24/7 autonomously | No | Manual | Yes | **Yes** |
| Swap AI providers anytime | N/A | Manual | N/A | **Yes** |
| Budget and spend controls | No | No | No | **Yes** |

<br>

## How It Works

**1. You describe the work.** Nooterra infers the tools, rules, and schedule &mdash; or you configure every detail yourself.

**2. Workers follow a charter.** Every worker gets explicit authority boundaries. `canDo` actions run autonomously. `askFirst` actions pause for your approval. `neverDo` actions are hard-blocked at runtime, regardless of what the model says.

**3. Sensitive actions need approval.** When a worker wants to issue a refund or send a customer email, it pauses and routes to you with full context &mdash; the draft, the source data, and its reasoning. Approve, edit, or reject in seconds.

**4. Everything is logged.** Every action, every tool call, every decision &mdash; recorded with full audit trails. You see exactly what happened and why.

<br>

## Features

### Guardrails That Are Actually Enforced

```yaml
canDo:
  - Read customer emails
  - Look up FAQ answers
  - Search the web
askFirst:
  - Issue refunds
  - Send external communications
neverDo:
  - Share customer data between customers
  - Make up information
  - Delete records
```

Not prompt instructions. Runtime-enforced action classification with a fail-closed default &mdash; unknown actions require approval.

### Approvals Built In

Workers pause on sensitive actions and route them to you with full context. Approve from multiple channels simultaneously:

- **Terminal** &mdash; interactive prompt during execution
- **Slack** &mdash; approve from a DM
- **Webhooks** &mdash; integrate with any system
- **Auto-approve** &mdash; same action approved 3x in 24h? Auto-approve next time

First response wins. 5-minute timeout, fail-closed by default.

### Runs 24/7

```sh
nooterra daemon start       # Background daemon with crash recovery
nooterra daemon status      # Health check
nooterra daemon install     # Auto-start on login (macOS/Linux)
```

Cron schedules, webhook triggers, file watchers, email polling, or continuous operation. Crash recovery with exponential backoff. Workers keep running after you close the terminal.

### Any AI Provider

| Provider | Setup | Cost |
|----------|-------|------|
| ChatGPT | OAuth sign-in | Your subscription |
| OpenAI | API key | Pay-per-use |
| Anthropic (Claude) | API key | Pay-per-use |
| Google (Gemini) | API key | Free tier available |
| OpenRouter | API key | 200+ models |
| Groq | API key | Free tier available |
| Ollama | Local install | Free forever |

Swap providers anytime. Workers keep their identity, knowledge, and charter.

### Real Tools, Zero Config

| Tool | What It Does |
|------|-------------|
| `web_fetch` | Fetch any webpage, extract text/links/JSON |
| `web_search` | Search the web via DuckDuckGo/Brave |
| `read_file` / `write_file` | Read and write local files |
| `slack_send` / `slack_read` | Send and read Slack messages |
| `github_api` | Repos, issues, PRs |
| `send_email` | Send emails via SMTP |

Connect more with `nooterra add <tool>` &mdash; Stripe, Notion, Google Sheets, and [20+ integrations](https://docs.nooterra.com/capabilities).

### Live Activity Feed

```
  0.0s  ▶ Starting Customer Support Worker
  0.3s  ⏳ Thinking... (round 1)
  2.1s  🔧 web_fetch (https://acme.com/billing)
  3.8s  ✓ web_fetch → 2341 chars
  3.9s  🛡️ Charter: canDo rule matched
  4.1s  🔧 send_email (draft reply to sarah@acme.com)
  4.2s  ⚡ Charter: askFirst — routing to approval
  4.2s  ⏸  Waiting for approval...
  5.8s  ✓ Approved (terminal)
  6.1s  ✓ send_email → sent
  6.3s  ✅ Done — 2 rounds, 3 tools, $0.003
```

Every execution is recorded. View logs, costs, and audit trails anytime with `nooterra logs`.

<br>

## Install

<table>
<tr>
<td>

**npm** (recommended)

```sh
npm install -g nooterra
```

</td>
<td>

**Homebrew**

```sh
brew install nooterra/tap/nooterra
```

</td>
</tr>
<tr>
<td>

**curl**

```sh
curl -fsSL https://nooterra.com/install.sh | sh
```

</td>
<td>

**From source**

```sh
git clone https://github.com/nooterra/nooterra.git
cd nooterra && npm ci && node bin/nooterra.js
```

</td>
</tr>
</table>

Requires Node.js 20+.

<br>

## Worker Templates

Get started fast with pre-built worker types:

| Template | What It Does | Tools |
|----------|-------------|-------|
| **Customer Support** | Handle inbound questions, look up accounts, draft replies | Email, Stripe, Slack |
| **Sales Assistant** | Research leads, draft outreach, track competitors | Browser, Email |
| **Data Monitor** | Watch websites for changes, alert on differences | Browser |
| **Content Writer** | Research topics, write drafts, check for quality | Browser |
| **Meeting Assistant** | Summarize discussions, extract action items | Slack |
| **HR Onboarding** | Answer questions, share checklists, send welcome messages | Email, Slack |

```sh
nooterra
> /templates
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

Then from your AI tool: *"Create a nooterra worker that monitors competitor prices"*

<br>

<details>
<summary><b>All CLI Commands</b></summary>

```sh
# Create and manage
nooterra                      # Interactive TUI
nooterra new                  # Create a worker
nooterra workers              # List workers
nooterra templates            # Quick start templates
nooterra teach <worker> <info> # Teach company knowledge

# Run and monitor
nooterra run <worker>         # Run with live activity feed
nooterra test <worker>        # Dry run
nooterra logs <worker>        # Execution history
nooterra dashboard            # System dashboard

# Tools
nooterra add <tool>           # Connect a tool (Slack, GitHub, etc.)
nooterra tools                # List tool status

# Daemon
nooterra daemon start         # Run workers 24/7
nooterra daemon status        # Check health
nooterra daemon install       # Auto-start on login

# Operations
nooterra approvals            # Pending approval queue
nooterra cost                 # Provider cost tracking
nooterra health               # Provider health + circuit breakers
```

</details>

<br>

## Documentation

Full docs at **[nooterra.ai/docs](https://nooterra.ai/docs)**

- [Getting Started](https://nooterra.ai/docs/getting-started) &mdash; Install to first worker in 5 minutes
- [Creating Workers](https://nooterra.ai/docs/creating-workers) &mdash; Conversational flow, instant mode, templates
- [Charters & Guardrails](https://nooterra.ai/docs/charters) &mdash; canDo / askFirst / neverDo
- [Approvals](https://nooterra.ai/docs/approvals) &mdash; Multi-channel approval flows
- [AI Providers](https://nooterra.ai/docs/providers) &mdash; Setup for all 7 providers
- [CLI Reference](https://nooterra.ai/docs/reference/cli) &mdash; Every command

<br>

## Community

- [GitHub Discussions](https://github.com/nooterra/nooterra/discussions)
- [Discord](https://discord.gg/nooterra)
- [Twitter / X](https://twitter.com/nooterra)
- [nooterra.ai](https://nooterra.ai)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
