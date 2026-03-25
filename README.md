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
</p>

<!-- TODO: Replace with actual demo GIF once generated with VHS -->
<!-- <p align="center"><img src=".github/assets/demo.gif" width="600" alt="Nooterra demo"></p> -->

## Quick Start

```sh
npm install -g nooterra
nooterra
```

Describe what you need. A governed worker deploys in seconds:

```
> I need a support worker that handles billing questions, looks up
  customers in Stripe, and drafts refund replies

  Customer Support Worker
    Tools: Email, Stripe, Slack
    Can do: Read emails, Look up billing, Draft replies
    Ask first: Issue refunds, Make promises about features
    Never do: Share customer data, Make up information
    Schedule: Continuous

  Deploy? yes

  Worker deployed. Run: nooterra run "Customer Support Worker"
```

## How It Works

**You describe the work.** Nooterra infers the tools, rules, and schedule.

**Workers follow a charter.** Every worker has explicit authority boundaries &mdash; what it can do autonomously, what needs your approval, and what it must never do. Enforced at runtime, not just in the prompt.

**Sensitive actions need approval.** When a worker wants to issue a refund or send an external email, it pauses and routes to you. Approve from your terminal, Slack, or a webhook. The worker waits.

**Everything is logged.** Every action, every tool call, every decision &mdash; recorded with full audit trails. You see exactly what happened and why.

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

Not prompt instructions. Runtime-enforced action classification. `neverDo` actions are blocked regardless of what the model says. Unknown actions default to requiring approval.

### Approvals Built In

Workers pause on sensitive actions and route them to you with full context &mdash; the draft, the source data, and the reasoning. Approve, edit, or reject in seconds.

- Terminal prompts
- Slack messages
- Webhooks
- Auto-approve after repeated identical approvals

### Runs 24/7

```sh
nooterra daemon start       # Background daemon with crash recovery
nooterra daemon status      # Health check
nooterra daemon install     # Auto-start on login (macOS/Linux)
```

Cron schedules, webhook triggers, file watchers, email polling, or continuous operation. Workers keep running after you close the terminal.

### Any AI Provider

| Provider | Setup |
|----------|-------|
| ChatGPT (subscription) | OAuth sign-in |
| OpenAI API | API key |
| Anthropic (Claude) | API key |
| Google (Gemini) | API key |
| OpenRouter (200+ models) | API key |
| Groq (fast, free tier) | API key |
| Ollama (local, free) | No key needed |

Swap providers anytime. Workers keep their identity, knowledge, and rules.

### Real Tools, Zero Config

| Tool | What It Does |
|------|-------------|
| `web_fetch` | Fetch any webpage, extract text/links/JSON |
| `web_search` | Search the web via DuckDuckGo/Brave |
| `read_file` / `write_file` | Read and write local files |
| `slack_send` / `slack_read` | Send and read Slack messages |
| `github_api` | Repos, issues, PRs |
| `send_email` | Send emails via SMTP |

Connect more with `nooterra add <tool>` &mdash; Stripe, Notion, Google Sheets, and 20+ integrations.

### Live Activity Feed

```
  0.0s  Thinking... (round 1)
  2.1s  web_fetch (https://acme.com/pricing)
  3.8s  web_fetch -> 2341 chars
  3.9s  Charter: canDo rule matched
  4.1s  web_search ("acme pricing changes")
  5.2s  Done -- 2 rounds, 2 tools, $0.003
```

Every execution is recorded. View logs, costs, and audit trails anytime.

## Install

### npm (recommended)

```sh
npm install -g nooterra
```

### Homebrew

```sh
brew install nooterra/tap/nooterra
```

### curl

```sh
curl -fsSL https://nooterra.com/install.sh | sh
```

### From source

```sh
git clone https://github.com/nooterra/nooterra.git
cd nooterra && npm ci
node bin/nooterra.js
```

## Worker Templates

Get started fast with pre-built worker types:

| Template | What It Does |
|----------|-------------|
| Customer Support | Handle inbound questions, look up accounts, draft replies |
| Sales Assistant | Research leads, draft outreach, track competitors |
| Data Monitor | Watch websites for changes, alert on differences |
| Content Writer | Research topics, write drafts, check for quality |
| Meeting Assistant | Summarize discussions, extract action items |
| HR Onboarding | Answer questions, share checklists, send welcome messages |

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

## Documentation

Full docs at [docs.nooterra.com](https://docs.nooterra.com)

- [Getting Started](https://docs.nooterra.com/getting-started)
- [Creating Workers](https://docs.nooterra.com/creating-workers)
- [Charters & Guardrails](https://docs.nooterra.com/charters)
- [Approvals](https://docs.nooterra.com/approvals)
- [AI Providers](https://docs.nooterra.com/providers)
- [CLI Reference](https://docs.nooterra.com/reference/cli)

## Community

- [GitHub Discussions](https://github.com/nooterra/nooterra/discussions)
- [Discord](https://discord.gg/nooterra)
- [Twitter](https://twitter.com/nooterra)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
